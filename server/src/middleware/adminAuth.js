import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { Admin } from '../models/Admin.js';
import { AppError, asyncHandler } from '../utils/AppError.js';

/**
 * Admins use a completely separate session cookie (and JWT) from customers, so the two
 * authentication systems never overlap. Tokens carry `typ: 'admin'` and only ever resolve
 * against the Admin collection.
 */
export const ADMIN_COOKIE_NAME = 'wristora_admin_token';

const cookieOptions = (maxAge) => ({
  httpOnly: true,
  secure: env.isProd || env.COOKIE_SAMESITE === 'none',
  sameSite: env.COOKIE_SAMESITE,
  path: '/',
  ...(maxAge ? { maxAge } : {}),
});

export function setAdminCookie(res, admin) {
  const token = jwt.sign({ sub: String(admin._id), role: admin.role, tv: admin.tokenVersion, typ: 'admin' },
    env.JWT_SECRET, { expiresIn: `${env.JWT_EXPIRES_DAYS}d`, algorithm: 'HS256' });
  res.cookie(ADMIN_COOKIE_NAME, token, cookieOptions(env.JWT_EXPIRES_DAYS * 86_400_000));
}
export const clearAdminCookie = (res) => res.clearCookie(ADMIN_COOKIE_NAME, cookieOptions());

/** Attaches req.user/req.admin if a valid admin session exists; never rejects. */
export const optionalAdminAuth = asyncHandler(async (req, _res, next) => {
  const token = req.cookies?.[ADMIN_COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.typ !== 'admin') return next();
    const admin = await Admin.findById(payload.sub);
    if (admin && admin.status === 'active' && admin.tokenVersion === payload.tv) {
      req.admin = admin;
      req.user = admin; // route handlers across /api/admin/* read req.user._id as the actor
    }
  } catch { /* invalid/expired token: treat as logged out */ }
  next();
});

export const requireAdminAuth = [
  optionalAdminAuth,
  (req, _res, next) => (req.admin ? next() : next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in.'))),
];

export const requireSuperAdmin = [
  ...requireAdminAuth,
  (req, _res, next) => (req.admin?.role === 'super_admin'
    ? next()
    : next(new AppError(403, 'FORBIDDEN', 'Super admin access required.'))),
];
