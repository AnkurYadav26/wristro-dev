import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { User } from '../models/User.js';
import { AppError, asyncHandler } from '../utils/AppError.js';

export const COOKIE_NAME = 'wristora_token';

export function setAuthCookie(res, user) {
  const token = jwt.sign({ sub: String(user._id), role: user.role, tv: user.tokenVersion }, env.JWT_SECRET, {
    expiresIn: `${env.JWT_EXPIRES_DAYS}d`,
    algorithm: 'HS256',
  });
  res.cookie(COOKIE_NAME, token, cookieOptions(env.JWT_EXPIRES_DAYS * 86_400_000));
}
export const clearAuthCookie = (res) => res.clearCookie(COOKIE_NAME, cookieOptions());

const cookieOptions = (maxAge) => ({
  httpOnly: true,
  secure: env.isProd || env.COOKIE_SAMESITE === 'none',
  sameSite: env.COOKIE_SAMESITE,
  path: '/',
  ...(maxAge ? { maxAge } : {}),
});

/** Attaches req.user if a valid session cookie exists; never rejects. */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await User.findById(payload.sub);
    if (user && user.status === 'active' && user.tokenVersion === payload.tv) req.user = user;
  } catch { /* invalid/expired token: treat as logged out */ }
  next();
});

export const requireAuth = [
  optionalAuth,
  (req, _res, next) => (req.user ? next() : next(new AppError(401, 'UNAUTHENTICATED', 'Please log in.'))),
];
