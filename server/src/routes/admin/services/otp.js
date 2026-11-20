/** Pure OTP helpers (no DB). The database-backed flow lives in otpService.js */
import crypto from 'node:crypto';

export const OTP_DEFAULTS = Object.freeze({
  length: 6,
  ttlMs: 10 * 60 * 1000,
  resendCooldownMs: 60 * 1000,
  maxAttempts: 5,
  maxSendsPerHour: 5,
});

export function generateOtp(length = OTP_DEFAULTS.length) {
  return String(crypto.randomInt(0, 10 ** length)).padStart(length, '0');
}

/** Keyed HMAC so a leaked collection can't be brute-forced offline without the secret. */
export function hashOtp(code, identifier, purpose, secret) {
  return crypto.createHmac('sha256', secret).update(`${purpose}\u0000${identifier}\u0000${code}`).digest('hex');
}

export function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

/** ms the caller must still wait before another send (0 = may send now). */
export function resendWaitMs(record, now = Date.now(), cooldownMs = OTP_DEFAULTS.resendCooldownMs) {
  if (!record?.lastSentAt) return 0;
  return Math.max(0, new Date(record.lastSentAt).getTime() + cooldownMs - now);
}

/** Hourly send quota. Returns the next { windowStart, sendCount } or { blocked, retryAfterMs }. */
export function nextSendWindow(record, now = Date.now(), maxPerHour = OTP_DEFAULTS.maxSendsPerHour) {
  const hour = 60 * 60 * 1000;
  const start = record?.windowStart ? new Date(record.windowStart).getTime() : 0;
  if (!record || now - start >= hour) return { windowStart: new Date(now), sendCount: 1 };
  if (record.sendCount >= maxPerHour) return { blocked: true, retryAfterMs: start + hour - now };
  return { windowStart: new Date(start), sendCount: record.sendCount + 1 };
}

/**
 * Decide the outcome of a verification attempt.
 * `record.attempts` must ALREADY include this attempt (increment atomically first).
 */
export function evaluateAttempt(record, { code, identifier, purpose, secret, now = Date.now(), maxAttempts = OTP_DEFAULTS.maxAttempts }) {
  if (!record || record.consumed) return 'NO_OTP';
  if (new Date(record.expiresAt).getTime() <= now) return 'EXPIRED';
  if (record.attempts > maxAttempts) return 'TOO_MANY_ATTEMPTS';
  const ok = safeEqualHex(record.codeHash, hashOtp(String(code), identifier, purpose, secret));
  return ok ? 'OK' : 'INVALID';
}
