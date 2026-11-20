import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(5000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  OTP_SECRET: z.string().min(32, 'OTP_SECRET must be at least 32 characters'),
  JWT_EXPIRES_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  // Comma-separated allowed frontend origins (CORS + CSRF origin check). The deployed
  // frontend is included so the projects connect even if this env var is unset.
  // The storefront (5173) and the standalone admin panel (5174) are separate frontends, so both
  // origins are allowed; add the deployed admin URL when it is live.
  CLIENT_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174,https://wristro-dev-igkp.vercel.app'),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  // Leave unset to auto-detect: 1 hop in production (Vercel/Render/Nginx), 0 in dev.
  TRUST_PROXY: z.coerce.number().int().min(0).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('WRISTORA <no-reply@localhost>'),
  PROMO_COUPON_CODE: z.string().trim().toUpperCase().default('WATCH60'),
  DEFAULT_DISCOUNT_PERCENT: z.coerce.number().min(0).max(90).default(40),
  STOCK_RESERVATION_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  SHIPPING_FLAT_PAISE: z.coerce.number().int().min(0).default(9900),
  // Free shipping at/above this goods amount (paise). Set to "none" to charge shipping on every order.
  FREE_SHIPPING_ABOVE_PAISE: z.string().default('99900').transform((v) => (v.trim().toLowerCase() === 'none' ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0), 'must be a non-negative integer or "none"'),
  PINCODE_API_URL: z.string().url().default('https://api.postalpincode.in/pincode'),
  CART_MAX_ITEMS: z.coerce.number().int().min(1).max(100).default(30),
  MAX_ADDRESSES: z.coerce.number().int().min(1).max(50).default(10),
  MAX_QTY_PER_LINE: z.coerce.number().int().min(1).max(100).default(10),
  // Seed script only: creates/promotes the admin account. Kept permissive so a short
  // dev password (e.g. "admin") works; use a long random value in production.
  ADMIN_NAME: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(4, 'ADMIN_PASSWORD must be at least 4 characters').optional(),
  // The Super Admin's mailbox. A copy of every new-admin activation code is sent here, and the
  // second code is verified against this address. Defaults to the store owner's inbox.
  SUPER_ADMIN_EMAIL: z.string().trim().toLowerCase().email().default('rydosphere@gmail.com'),
  // Razorpay. Optional: blank values switch payments to a simulated gateway in development.
  RAZORPAY_KEY_ID: z.string().trim().optional(),
  RAZORPAY_KEY_SECRET: z.string().trim().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().trim().optional(),
  // Cloudinary (admin product-image uploads). Optional: blank values disable uploading.
  CLOUDINARY_CLOUD_NAME: z.string().trim().optional(),
  CLOUDINARY_API_KEY: z.string().trim().optional(),
  CLOUDINARY_API_SECRET: z.string().trim().optional(),
  CLOUDINARY_FOLDER: z.string().trim().default('wristora/products'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${msg}`);
}
const env = parsed.data;
const clientOrigins = env.CLIENT_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);

// Behind Vercel/Render/Nginx the app always sits behind one proxy. Trusting it keeps
// req.ip and express-rate-limit correct. In production an explicit 0 (easy to copy from a
// dev .env) would make every request fail, so fall back to 1 unless you set a real hop count.
const TRUST_PROXY = env.NODE_ENV === 'production' ? env.TRUST_PROXY || 1 : env.TRUST_PROXY ?? 0;
// The deployed frontend and API are on different sites (two *.vercel.app subdomains), so
// the auth cookie must be SameSite=None. Local dev stays same-site and keeps the lax default.
const COOKIE_SAMESITE = env.NODE_ENV === 'production' && env.COOKIE_SAMESITE === 'lax' ? 'none' : env.COOKIE_SAMESITE;

if (env.NODE_ENV === 'production') {
  if (!env.SMTP_HOST) throw new Error('SMTP_HOST is required in production (OTP emails cannot be delivered otherwise).');
  if (COOKIE_SAMESITE === 'none' && !clientOrigins.every((o) => o.startsWith('https://'))) {
    throw new Error('COOKIE_SAMESITE=none requires HTTPS client origins.');
  }
}

export default Object.freeze({
  ...env,
  TRUST_PROXY,
  COOKIE_SAMESITE,
  isProd: env.NODE_ENV === 'production',
  clientOrigins,
});
