import { Router } from 'express';
import { z } from 'zod';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';
import { Coupon } from '../models/Coupon.js';
import { AppError, asyncHandler } from '../utils/AppError.js';
import { validate } from '../middleware/validate.js';
import { optionalAuth } from '../middleware/auth.js';
import { quoteBody } from '../schemas.js';
import { buildProductFilter, buildSort, SORTS } from '../utils/catalogQuery.js';
import { parsePaging } from '../utils/misc.js';
import { priceCart } from '../services/pricing.js';
import { quoteCart } from '../services/quoteService.js';
import env from '../config/env.js';

const router = Router();

router.get('/categories', asyncHandler(async (_req, res) => {
  res.json({ categories: await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean() });
}));

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(200).optional(), // category slug(s), comma separated
  brand: z.string().max(300).optional(), watchType: z.string().max(100).optional(),
  gender: z.string().max(100).optional(), colour: z.string().max(200).optional(), features: z.string().max(300).optional(),
  minPrice: z.coerce.number().int().min(0).optional(), maxPrice: z.coerce.number().int().min(0).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  inStock: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  sort: z.enum(Object.keys(SORTS)).default('relevance'),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(60).default(20),
}).passthrough();

/** The live promo coupon (default WATCH60), used for "price with coupon" hints on product pages. */
async function promoHint() {
  const now = new Date();
  const c = await Coupon.findOne({ active: true, code: env.PROMO_COUPON_CODE, $and: [
    { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }, { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }] }).lean();
  return c;
}
function withPromo(doc, coupon) {
  const out = doc.toPublic(env.MAX_QTY_PER_LINE);
  if (coupon && (!coupon.productIds?.length && !coupon.categoryIds?.length)) {
    const r = priceCart([{ product: { id: String(doc._id), categoryId: String(doc.categoryId), mrpPaise: doc.mrpPaise, discountPercent: doc.discountPercent,
      purchaseCostPaise: doc.purchaseCostPaise, gstPercent: doc.gstPercent, minMarginPercent: doc.minMarginPercent, allowBelowCostCoupon: doc.allowBelowCostCoupon }, quantity: 1 }], coupon);
    // Only advertise the coupon price when it genuinely applies to this product (margin guard etc.)
    if (r.coupon?.applied) { out.promoPricePaise = r.totalPaise; out.promoCode = coupon.code; }
  }
  return out;
}

router.get('/products', validate({ query: listQuery }), asyncHandler(async (req, res) => {
  const q = req.validatedQuery;
  let categoryIds;
  if (q.category) {
    const cats = await Category.find({ slug: { $in: q.category.split(',').map((s) => s.trim().toLowerCase()) }, isActive: true }).select('_id').lean();
    categoryIds = cats.map((c) => c._id);
    if (!categoryIds.length) return res.json({ products: [], page: q.page, limit: q.limit, total: 0 });
  }
  const filter = buildProductFilter(q, { categoryIds });
  const sort = buildSort(q.sort, Boolean(q.q));
  const { skip, limit } = parsePaging(q);
  const projection = q.q ? { score: { $meta: 'textScore' } } : undefined;
  const [docs, total, coupon] = await Promise.all([
    Product.find(filter, projection).sort(sort).skip(skip).limit(limit),
    Product.countDocuments(filter), promoHint(),
  ]);
  res.json({ products: docs.map((d) => withPromo(d, coupon)), page: q.page, limit, total });
}));

router.get('/products/:slug', asyncHandler(async (req, res) => {
  const doc = await Product.findOne({ slug: String(req.params.slug).toLowerCase(), isActive: true, isArchived: false });
  if (!doc) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  const [coupon, siblings, category] = await Promise.all([
    promoHint(),
    doc.variantGroup ? Product.find({ variantGroup: doc.variantGroup, isActive: true, isArchived: false, _id: { $ne: doc._id } }).select('slug colour images').lean() : [],
    doc.categoryId ? Category.findById(doc.categoryId).select('slug name').lean() : null,
  ]);
  const product = withPromo(doc, coupon);
  // Let the storefront group "same category" suggestions without a second lookup.
  if (category) { product.categorySlug = category.slug; product.categoryName = category.name; }
  res.json({ product, variants: siblings.map((s) => ({ slug: s.slug, colour: s.colour, image: s.images?.[0]?.url })) });
}));

/** Server-side price quote: the single source of truth the cart/checkout UI must display. */
router.post('/pricing/quote', optionalAuth, validate({ body: quoteBody }), asyncHandler(async (req, res) => {
  const q = await quoteCart({ items: req.body.items, couponCode: req.body.couponCode, userId: req.user?._id ?? null });
  res.json(q);
}));

export default router;
