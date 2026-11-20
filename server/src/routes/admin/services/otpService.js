import env from '../config/env.js';
import { OtpToken } from '../models/OtpToken.js';
import { AppError } from '../utils/AppError.js';
import { OTP_DEFAULTS, generateOtp, hashOtp, resendWaitMs, nextSendWindow, evaluateAttempt } from './otp.js';
import { sendOtpEmail } from './mailer.js';

/**
 * Issue (or re-issue) an OTP for an email + purpose. Enforces cooldown and hourly quota.
 * `ignoreCooldown` is used by the admin sign-in flow, where a fresh code is expected on every
 * login (the previous one was consumed), while the hourly quota still applies.
 */
export async function issueEmailOtp(email, purpose, { ignoreCooldown = false } = {}) {
  const existing = await OtpToken.findOne({ identifier: email, purpose });
  if (!ignoreCooldown) {
    const wait = resendWaitMs(existing);
    if (wait > 0) throw new AppError(429, 'OTP_COOLDOWN', `Please wait ${Math.ceil(wait / 1000)}s before requesting another code.`, { retryAfterSeconds: Math.ceil(wait / 1000) });
  }
  const win = nextSendWindow(existing);
  if (win.blocked) throw new AppError(429, 'OTP_QUOTA', 'Too many codes requested. Try again later.', { retryAfterSeconds: Math.ceil(win.retryAfterMs / 1000) });

  const code = generateOtp();
  const now = new Date();
  await OtpToken.findOneAndUpdate(
    { identifier: email, purpose },
    { $set: { codeHash: hashOtp(code, email, purpose, env.OTP_SECRET), expiresAt: new Date(now.getTime() + OTP_DEFAULTS.ttlMs),
        attempts: 0, consumed: false, lastSentAt: now, windowStart: win.windowStart, sendCount: win.sendCount } },
    { upsert: true },
  );
  await sendOtpEmail(email, code, purpose, OTP_DEFAULTS.ttlMs / 60000);
}

/** Verify a code. Attempts are counted atomically BEFORE comparing, so parallel guesses can't race the limit. */
export async function verifyEmailOtp(email, purpose, code) {
  const rec = await OtpToken.findOneAndUpdate({ identifier: email, purpose, consumed: false }, { $inc: { attempts: 1 } }, { new: true });
  const outcome = evaluateAttempt(rec, { code, identifier: email, purpose, secret: env.OTP_SECRET });
  if (outcome === 'OK') {
    const used = await OtpToken.findOneAndUpdate({ _id: rec._id, consumed: false }, { $set: { consumed: true } });
    if (used) return true; // lost a race with a parallel correct submission: fall through to failure
  }
  const messages = {
    NO_OTP: 'No active code. Please request a new one.',
    EXPIRED: 'This code has expired. Please request a new one.',
    TOO_MANY_ATTEMPTS: 'Too many incorrect attempts. Please request a new code.',
    INVALID: 'Incorrect code.',
    OK: 'This code was already used.',
  };
  throw new AppError(400, `OTP_${outcome === 'OK' ? 'USED' : outcome}`, messages[outcome]);
}
