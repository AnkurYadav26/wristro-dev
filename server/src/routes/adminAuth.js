import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import env from '../config/env.js';
import { Admin } from '../models/Admin.js';
import { AppError, asyncHandler } from '../utils/AppError.js';
import { validate } from '../middleware/validate.js';
import { authLimiter, otpLimiter } from '../middleware/security.js';
import { setAdminCookie, clearAdminCookie, requireAdminAuth, requireSuperAdmin } from '../middleware/adminAuth.js';
import { emailSchema, objectId } from '../schemas.js';
import { issueEmailOtp, verifyEmailOtp, verifyEmailOtpTogether } from '../services/otpService.js';

/**
 * Administrator authentication, fully independent of the customer auth in routes/auth.js.
 * Admin sessions use their own cookie and resolve against the Admin collection only.
 */
const router = Router();
const BCRYPT_COST = 12;
// Equalises response timing when the account does not exist (prevents enumeration).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);
const adminPasswordSchema = z.string().min(8, 'Use at least 8 characters').max(128)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'Include at least one letter and one number');
const otpSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');

/** Step 1 — email + password. On success a code is emailed ONLY to the admin's own address. */
router.post('/login', authLimiter,
  validate({ body: z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict() }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email }).select('+passwordHash');
    const ok = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);
    if (!admin || !ok) throw new AppError(401, 'BAD_CREDENTIALS', 'Incorrect email or password.');
    if (admin.status === 'pending') throw new AppError(403, 'ADMIN_PENDING', 'This administrator account has not been activated yet.');
    if (admin.status !== 'active') throw new AppError(403, 'ACCOUNT_BLOCKED', 'This administrator account has been disabled.');
    await issueEmailOtp(admin.email, 'admin_login', { ignoreCooldown: true });
    res.json({ otpRequired: true, email: admin.email, message: 'We emailed you a 6-digit code. Enter it to finish signing in.' });
  }));

/** Step 2 — exchange the emailed code for an admin session. */
router.post('/verify-login', otpLimiter,
  validate({ body: z.object({ email: emailSchema, otp: otpSchema }).strict() }),
  asyncHandler(async (req, res) => {
    const { email, otp } = req.body;
    await verifyEmailOtp(email, 'admin_login', otp);
    const admin = await Admin.findOneAndUpdate({ email, status: 'active' },
      { $set: { lastLoginAt: new Date(), emailVerified: true } }, { new: true });
    if (!admin) throw new AppError(403, 'NOT_ADMIN', 'This account is not an active administrator.');
    setAdminCookie(res, admin);
    res.json({ admin: admin.toPublic() });
  }));

router.post('/resend-otp', otpLimiter,
  validate({ body: z.object({ email: emailSchema }).strict() }),
  asyncHandler(async (req, res) => {
    const admin = await Admin.findOne({ email: req.body.email, status: 'active' });
    if (admin) {
      try { await issueEmailOtp(admin.email, 'admin_login'); }
      catch (e) { if (!(e instanceof AppError && e.status === 429)) throw e; } // swallow cooldown, keep the reply uniform
    }
    res.json({ message: 'If the account exists, a new code has been sent.' });
  }));

router.post('/logout', (_req, res) => { clearAdminCookie(res); res.json({ message: 'Logged out.' }); });

router.get('/me', requireAdminAuth, (req, res) => res.json({ admin: req.admin.toPublic() }));

router.post('/change-password', requireAdminAuth, authLimiter,
  validate({ body: z.object({
    currentPassword: z.string().min(1).max(128), newPassword: adminPasswordSchema, confirmPassword: z.string(),
  }).strict().refine((b) => b.newPassword === b.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' }) }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const admin = await Admin.findById(req.admin._id).select('+passwordHash');
    if (!admin) throw new AppError(404, 'NO_ACCOUNT', 'Administrator not found.');
    const ok = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!ok) throw new AppError(401, 'BAD_CURRENT_PASSWORD', 'Your current password is incorrect.');
    admin.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    admin.tokenVersion += 1; // signs out every other device; the fresh cookie keeps this session
    await admin.save();
    setAdminCookie(res, admin);
    res.json({ message: 'Password updated.' });
  }));

/* ---------------- Super Admin: manage administrator accounts ---------------- */

/** A copy of the activation code goes to the new admin AND to the Super Admin's inbox. */
async function issueActivationOtps(admin) {
  const tasks = [issueEmailOtp(admin.email, 'admin_activation', { ignoreCooldown: true })];
  if (env.SUPER_ADMIN_EMAIL && env.SUPER_ADMIN_EMAIL !== admin.email) {
    tasks.push(issueEmailOtp(env.SUPER_ADMIN_EMAIL, 'admin_activation', { ignoreCooldown: true }));
  }
  await Promise.all(tasks);
}

router.get('/administrators', requireSuperAdmin, asyncHandler(async (_req, res) =>
  res.json({ administrators: (await Admin.find().sort({ createdAt: -1 })).map((a) => a.toPublic()) })));

router.post('/administrators', requireSuperAdmin,
  validate({ body: z.object({ name: z.string().trim().min(2).max(80), email: emailSchema, password: adminPasswordSchema }).strict() }),
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    if (await Admin.exists({ email })) throw new AppError(409, 'ADMIN_EXISTS', 'An administrator with this email already exists.');
    const admin = await Admin.create({
      name, email, passwordHash: await bcrypt.hash(password, BCRYPT_COST),
      role: 'admin', status: 'pending', emailVerified: false, createdBy: req.admin._id,
    });
    await issueActivationOtps(admin);
    res.status(201).json({
      administrator: admin.toPublic(),
      message: `Activation codes were emailed to ${admin.email} and ${env.SUPER_ADMIN_EMAIL}. Enter both to activate this administrator.`,
    });
  }));

router.post('/administrators/:id/resend-otp', requireSuperAdmin,
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const admin = await Admin.findById(req.params.id);
    if (!admin) throw new AppError(404, 'NOT_FOUND', 'Administrator not found.');
    if (admin.status !== 'pending') throw new AppError(409, 'ALREADY_ACTIVE', 'This administrator is already activated.');
    await issueActivationOtps(admin);
    res.json({ message: `New activation codes were emailed to ${admin.email} and ${env.SUPER_ADMIN_EMAIL}.` });
  }));

/** The account only activates once BOTH codes are correct (verified all-or-nothing). */
router.post('/administrators/:id/verify', requireSuperAdmin,
  validate({ params: z.object({ id: objectId }), body: z.object({ otp: otpSchema, superOtp: otpSchema }).strict() }),
  asyncHandler(async (req, res) => {
    const admin = await Admin.findById(req.params.id);
    if (!admin) throw new AppError(404, 'NOT_FOUND', 'Administrator not found.');
    if (admin.status === 'active') throw new AppError(409, 'ALREADY_ACTIVE', 'This administrator is already activated.');
    await verifyEmailOtpTogether([
      { identifier: admin.email, purpose: 'admin_activation', code: req.body.otp },
      { identifier: env.SUPER_ADMIN_EMAIL, purpose: 'admin_activation', code: req.body.superOtp },
    ]);
    admin.status = 'active';
    admin.emailVerified = true;
    await admin.save();
    res.json({ administrator: admin.toPublic(), message: 'Administrator activated.' });
  }));

export default router;
