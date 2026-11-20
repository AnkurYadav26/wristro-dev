import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { User } from '../models/User.js';
import { AppError, asyncHandler } from '../utils/AppError.js';
import { validate } from '../middleware/validate.js';
import { authLimiter, otpLimiter } from '../middleware/security.js';
import { requireAuth, setAuthCookie, clearAuthCookie } from '../middleware/auth.js';
import { emailSchema, passwordSchema, mobileSchema, otpSchema } from '../schemas.js';
import { issueEmailOtp, verifyEmailOtp } from '../services/otpService.js';

const router = Router();
const BCRYPT_COST = 12;
// Used to equalise timing when the account does not exist (prevents user enumeration by response time)
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

router.post('/register', authLimiter,
  validate({ body: z.object({
    name: z.string().trim().min(2).max(80), email: emailSchema, mobile: mobileSchema,
    password: passwordSchema, confirmPassword: z.string(),
  }).strict().refine((b) => b.password === b.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' }) }),
  asyncHandler(async (req, res) => {
    const { name, email, mobile, password } = req.body;
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const [byEmail, byMobile] = await Promise.all([User.findOne({ email }), User.findOne({ mobile })]);
    if (byEmail?.emailVerified || byMobile?.emailVerified) {
      throw new AppError(409, 'ACCOUNT_EXISTS', 'An account with this email or mobile already exists.');
    }
    // Only unverified (abandoned) sign-ups remain. Let the person start over, e.g. after mistyping a field.
    if (byMobile && (!byEmail || String(byMobile._id) !== String(byEmail._id))) await byMobile.deleteOne();
    if (byEmail) { Object.assign(byEmail, { name, mobile, passwordHash }); await byEmail.save(); }
    else await User.create({ name, email, mobile, passwordHash });
    await issueEmailOtp(email, 'verify_email');
    res.status(201).json({ message: 'Account created. Enter the code we emailed to verify your address.', email });
  }));

router.post('/verify-email', otpLimiter,
  validate({ body: z.object({ email: emailSchema, otp: otpSchema }).strict() }),
  asyncHandler(async (req, res) => {
    const { email, otp } = req.body;
    await verifyEmailOtp(email, 'verify_email', otp);
    const user = await User.findOneAndUpdate({ email }, { $set: { emailVerified: true, lastLoginAt: new Date() } }, { new: true });
    if (!user) throw new AppError(404, 'NO_ACCOUNT', 'Account not found.');
    setAuthCookie(res, user);
    res.json({ user: user.toPublic() });
  }));

router.post('/resend-otp', otpLimiter,
  validate({ body: z.object({ email: emailSchema, purpose: z.enum(['verify_email', 'reset_password', 'admin_login']) }).strict() }),
  asyncHandler(async (req, res) => {
    const { email, purpose } = req.body;
    const user = await User.findOne({ email });
    const eligible = user && (
      purpose === 'verify_email' ? !user.emailVerified
        : purpose === 'admin_login' ? user.role === 'admin' && user.status === 'active'
          : true
    );
    if (eligible) await issueEmailOtp(email, purpose);
    res.json({ message: 'If the account exists, a new code has been sent.' }); // same reply either way
  }));

router.post('/login', authLimiter,
  validate({ body: z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict() }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+passwordHash');
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new AppError(401, 'BAD_CREDENTIALS', 'Incorrect email or password.');
    if (user.status !== 'active') throw new AppError(403, 'ACCOUNT_BLOCKED', 'This account has been disabled. Please contact support.');
    // Admins must confirm a one-time code emailed to them on EVERY login, so the password step
    // returns an OTP challenge instead of a session. Confirming the code also proves the email
    // address is real, so the admin panel never depends on a separate verification step.
    if (user.role === 'admin') {
      await issueEmailOtp(user.email, 'admin_login', { ignoreCooldown: true });
      return res.json({ otpRequired: true, email: user.email, message: 'We emailed you a 6-digit code. Enter it to finish signing in.' });
    }
    if (!user.emailVerified) throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email to continue.', { email });
    user.lastLoginAt = new Date();
    await user.save();
    setAuthCookie(res, user);
    res.json({ user: user.toPublic() });
  }));

// Second step of the admin sign-in: exchange the emailed code for a session.
router.post('/verify-admin-login', otpLimiter,
  validate({ body: z.object({ email: emailSchema, otp: otpSchema }).strict() }),
  asyncHandler(async (req, res) => {
    const { email, otp } = req.body;
    await verifyEmailOtp(email, 'admin_login', otp);
    const user = await User.findOneAndUpdate(
      { email, role: 'admin', status: 'active' },
      { $set: { lastLoginAt: new Date(), emailVerified: true } },
      { new: true },
    );
    if (!user) throw new AppError(403, 'NOT_ADMIN', 'This account is not an admin.');
    setAuthCookie(res, user);
    res.json({ user: user.toPublic() });
  }));

router.post('/logout', (_req, res) => { clearAuthCookie(res); res.json({ message: 'Logged out.' }); });

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user.toPublic() }));

router.post('/forgot-password', authLimiter,
  validate({ body: z.object({ email: emailSchema }).strict() }),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (user && user.status === 'active') {
      try { await issueEmailOtp(user.email, 'reset_password'); }
      catch (e) { if (!(e instanceof AppError && e.status === 429)) throw e; } // swallow cooldown to keep replies uniform
    }
    res.json({ message: 'If an account exists for that email, a reset code has been sent.' });
  }));

router.post('/reset-password', otpLimiter,
  validate({ body: z.object({ email: emailSchema, otp: otpSchema, newPassword: passwordSchema }).strict() }),
  asyncHandler(async (req, res) => {
    const { email, otp, newPassword } = req.body;
    await verifyEmailOtp(email, 'reset_password', otp);
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    // Bumping tokenVersion logs the user out of every device.
    const user = await User.findOneAndUpdate({ email }, { $set: { passwordHash, emailVerified: true }, $inc: { tokenVersion: 1 } }, { new: true });
    if (!user) throw new AppError(404, 'NO_ACCOUNT', 'Account not found.');
    clearAuthCookie(res);
    res.json({ message: 'Password updated. Please log in.' });
  }));

router.post('/change-password', requireAuth, authLimiter,
  validate({ body: z.object({
    currentPassword: z.string().min(1).max(128), newPassword: passwordSchema, confirmPassword: z.string(),
  }).strict().refine((b) => b.newPassword === b.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' }) }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!user) throw new AppError(404, 'NO_ACCOUNT', 'Account not found.');
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new AppError(401, 'BAD_CURRENT_PASSWORD', 'Your current password is incorrect.');
    // Bumping tokenVersion logs out every other device; the fresh cookie keeps this session signed in.
    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    user.tokenVersion += 1;
    await user.save();
    setAuthCookie(res, user);
    res.json({ message: 'Password updated.' });
  }));

export default router;
