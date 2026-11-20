import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import { AppError } from '../utils/AppError.js';

/** Strip Mongo operator injection ($-prefixed or dotted keys) from user input, in place. */
function clean(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) { delete obj[key]; continue; }
    clean(obj[key]);
  }
}
export function sanitizeInput(req, _res, next) {
  clean(req.body); clean(req.query); clean(req.params);
  next();
}

/** CSRF defence-in-depth (alongside SameSite cookies): browsers always send Origin on cross-site writes. */
export function originCheck(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !env.clientOrigins.includes(origin)) {
    return next(new AppError(403, 'BAD_ORIGIN', 'Request origin not allowed.'));
  }
  next();
}

const limiter = (windowMs, limit, message, keyGenerator) =>
  rateLimit({
    windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', message)),
  });

export const apiLimiter = limiter(15 * 60_000, 600, 'Too many requests. Please slow down.');
const ipPlusEmail = (req) => `${req.ip}|${String(req.body?.email ?? '').toLowerCase()}`;
export const authLimiter = limiter(15 * 60_000, 20, 'Too many attempts. Try again in a few minutes.', ipPlusEmail);
export const otpLimiter = limiter(15 * 60_000, 10, 'Too many OTP requests. Try again later.', ipPlusEmail);
export const lookupLimiter = limiter(15 * 60_000, 60, 'Too many lookups. Please slow down.');
