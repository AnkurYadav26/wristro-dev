import { z } from 'zod';
import { canonicalState, normalizeMobile } from './utils/india.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const paise = z.number().int().min(0).max(1_000_000_00); // ≤ ₹10,00,000 per unit
const trimmed = (max = 200) => z.string().trim().min(1).max(max);

export const emailSchema = z.string().trim().toLowerCase().email().max(120);
export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(128)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'Include at least one letter and one number');
export const mobileSchema = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');
export const otpSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const quoteBody = z.object({
  items: z.array(z.object({ productId: objectId, quantity: z.number().int().min(1).max(100) }).strict()).min(1).max(50),
  couponCode: z.string().trim().max(30).optional(),
}).strict();

export const productFields = {
  name: trimmed(), sku: trimmed(40), brand: trimmed(60), categoryId: objectId,
  watchType: z.enum(['smart', 'digital', 'analog', 'hybrid']),
  gender: z.enum(['men', 'women', 'unisex']),
  variantGroup: z.string().trim().max(60), colour: z.string().trim().max(40),
  description: z.string().max(5000),
  images: z.array(z.object({ url: z.string().url(), alt: z.string().max(160).optional() }).strict()).max(12),
  features: z.array(trimmed(60)).max(30),
  specifications: z.array(z.object({ key: trimmed(60), value: trimmed(200) }).strict()).max(50),
  supplierId: objectId,
  purchaseCostPaise: paise,
  mrpPaise: paise.min(1),
  mrpSource: z.object({ name: trimmed(80), url: z.string().url().optional(), verifiedAt: z.coerce.date().optional(), note: z.string().max(300).optional() }).strict(),
  discountPercent: z.number().min(0).max(90),
  gstPercent: z.number().min(0).max(40),
  minMarginPercent: z.number().min(0).max(500),
  allowBelowCostCoupon: z.boolean(),
  lowStockThreshold: z.number().int().min(0).max(10000),
  weightGrams: z.number().min(0).max(5000),
  dimensionsMm: z.object({ length: z.number().min(0), width: z.number().min(0), height: z.number().min(0) }).strict(),
  warrantyMonths: z.number().int().min(0).max(120), warrantyNote: z.string().max(300),
  returnEligible: z.boolean(), returnWindowDays: z.number().int().min(0).max(60),
  isActive: z.boolean(),
};
// NOTE: stockOnHand / stockReserved are deliberately absent: stock only changes via /admin/inventory.
export const productCreate = z.object(productFields).partial()
  .required({ name: true, sku: true, brand: true, categoryId: true, watchType: true, mrpPaise: true }).strict();
export const productUpdate = z.object(productFields).partial().strict();

export const couponFields = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/),
  description: z.string().max(300),
  discountPercent: z.number().min(1).max(90),
  active: z.boolean(),
  startsAt: z.coerce.date().nullable(),
  expiresAt: z.coerce.date().nullable(),
  minOrderValuePaise: paise,
  maxDiscountPaise: paise.nullable(),
  usageLimit: z.number().int().min(1).nullable(),
  perCustomerLimit: z.number().int().min(1).nullable(),
  productIds: z.array(objectId).max(500),
  categoryIds: z.array(objectId).max(50),
});
export const couponCreate = couponFields.partial().required({ code: true, discountPercent: true }).strict();
export const couponUpdate = couponFields.omit({ code: true }).partial().strict();

/* ---- Phase 4: cart, addresses, checkout ---- */
const indianMobile = z.string().trim().transform((v) => normalizeMobile(v)).refine((v) => v !== null, 'Enter a valid 10-digit Indian mobile number');
const stateField = z.string().trim().transform((v) => canonicalState(v)).refine((v) => v !== null, 'Select a valid state or union territory');

export const addressBody = z.object({
  fullName: z.string().trim().min(2).max(80),
  mobile: indianMobile,
  alternateMobile: indianMobile.optional(),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'),
  houseNo: z.string().trim().min(1).max(60),
  buildingName: z.string().trim().max(100).optional(),
  street: z.string().trim().min(2).max(160),
  landmark: z.string().trim().max(100).optional(),
  city: z.string().trim().min(2).max(80),
  district: z.string().trim().min(2).max(80),
  state: stateField,
  country: z.literal('India').optional(), // accepted only as "India"; delivery is India-only
  isDefault: z.boolean().optional(),
}).strict();
export const addressUpdate = addressBody.partial();

export const cartAddBody = z.object({ productId: objectId, quantity: z.number().int().min(1).max(100).default(1) }).strict();
export const cartSetBody = z.object({ quantity: z.number().int().min(1).max(100) }).strict();

export const checkoutBody = z.object({
  source: z.enum(['cart', 'buy_now']),
  productId: objectId.optional(),               // buy_now only
  quantity: z.number().int().min(1).max(100).optional(), // buy_now only; cart quantities always come from the server-side cart
  productIds: z.array(objectId).min(1).max(50).optional(), // cart only: optional subset of the cart
  couponCode: z.string().trim().max(30).optional(),
  addressId: objectId.optional(),
}).strict().superRefine((b, ctx) => {
  if (b.source === 'buy_now') {
    if (!b.productId || !b.quantity) ctx.addIssue({ code: 'custom', path: ['productId'], message: 'buy_now requires productId and quantity' });
    if (b.productIds) ctx.addIssue({ code: 'custom', path: ['productIds'], message: 'productIds is only for source "cart"' });
  } else if (b.productId || b.quantity) {
    ctx.addIssue({ code: 'custom', path: ['productId'], message: 'For source "cart", quantities come from your saved cart' });
  }
});
export const idempotencyHeader = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Idempotency-Key must be 8-64 chars: letters, digits, _ or -');

/* ---- Phase 5: payments ---- */
// A simulated (dev-only) confirmation sends { simulated: true }; the real flow sends the
// three razorpay_* fields from the checkout callback.
export const paymentVerifyBody = z.object({
  simulated: z.literal(true).optional(),
  razorpay_order_id: z.string().trim().min(1).max(120).optional(),
  razorpay_payment_id: z.string().trim().min(1).max(120).optional(),
  razorpay_signature: z.string().trim().min(1).max(256).optional(),
}).strict();
