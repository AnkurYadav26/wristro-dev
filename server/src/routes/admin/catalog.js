import { Router } from 'express';
import { z } from 'zod';
import { Category } from '../../models/Category.js';
import { Product } from '../../models/Product.js';
import { Coupon } from '../../models/Coupon.js';
import { InventoryMovement } from '../../models/Inventory.js';
import { AppError, asyncHandler } from '../../utils/AppError.js';
import { validate } from '../../middleware/validate.js';
import { objectId, productCreate, productUpdate, couponCreate, couponUpdate } from '../../schemas.js';
import { slugify, shortId, parsePaging } from '../../utils/misc.js';
import env from '../../config/env.js';

const router = Router();
const idParam = validate({ params: z.object({ id: objectId }) });

/* ---------------- categories ---------------- */
const catBody = z.object({ name: z.string().trim().min(2).max(60), description: z.string().max(300).optional(),
  image: z.string().url().optional(), sortOrder: z.number().int().optional(), isActive: z.boolean().optional() }).strict();

router.get('/categories', asyncHandler(async (_req, res) => res.json({ categories: await Category.find().sort({ sortOrder: 1, name: 1 }).lean() })));
router.post('/categories', validate({ body: catBody }), asyncHandler(async (req, res) => {
  res.status(201).json({ category: await Category.create({ ...req.body, slug: slugify(req.body.name) }) });
}));
router.patch('/categories/:id', idParam, validate({ body: catBody.partial() }), asyncHandler(async (req, res) => {
  const patch = { ...req.body }; if (patch.name) patch.slug = slugify(patch.name);
  const c = await Category.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true, runValidators: true });
  if (!c) throw new AppError(404, 'NOT_FOUND', 'Category not found.');
  res.json({ category: c });
}));
router.delete('/categories/:id', idParam, asyncHandler(async (req, res) => {
  if (await Product.exists({ categoryId: req.params.id })) throw new AppError(409, 'IN_USE', 'Move or archive the products in this category first.');
  await Category.findByIdAndDelete(req.params.id);
  res.status(204).end();
}));

/* ---------------- products ---------------- */
const listQ = z.object({ q: z.string().trim().max(80).optional(), archived: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).passthrough();

router.get('/products', validate({ query: listQ }), asyncHandler(async (req, res) => {
  const q = req.validatedQuery;
  const f = { isArchived: q.archived === 'true' };
  if (q.q) { const rx = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); f.$or = [{ name: rx }, { sku: rx }, { brand: rx }]; }
  const { skip, limit } = parsePaging(q, 100);
  const [products, total] = await Promise.all([Product.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Product.countDocuments(f)]);
  res.json({ products: products.map((p) => ({ ...p, stockAvailable: p.stockOnHand - p.stockReserved })), total, page: q.page, limit });
}));
router.get('/products/:id', idParam, asyncHandler(async (req, res) => {
  const p = await Product.findById(req.params.id).lean();
  if (!p) throw new AppError(404, 'NOT_FOUND', 'Product not found.');
  res.json({ product: p });
}));
router.post('/products', validate({ body: productCreate }), asyncHandler(async (req, res) => {
  const b = req.body;
  const p = await Product.create({ ...b, slug: `${slugify(b.name)}-${shortId()}`, discountPercent: b.discountPercent ?? env.DEFAULT_DISCOUNT_PERCENT,
    stockOnHand: 0, stockReserved: 0 });
  res.status(201).json({ product: p, hint: 'Add stock via a purchase order or POST /api/admin/inventory/adjust (type: opening_stock).' });
}));
router.patch('/products/:id', idParam, validate({ body: productUpdate }), asyncHandler(async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) throw new AppError(404, 'NOT_FOUND', 'Product not found.');
  p.set(req.body);
  await p.save(); // .save() so the pre-validate hook re-derives sellingPricePaise
  res.json({ product: p });
}));
router.delete('/products/:id', idParam, asyncHandler(async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) throw new AppError(404, 'NOT_FOUND', 'Product not found.');
  const hasHistory = (await InventoryMovement.exists({ productId: p._id })) || p.stockOnHand > 0 || p.stockReserved > 0;
  if (hasHistory) {
    if (p.stockReserved > 0) throw new AppError(409, 'HAS_RESERVATIONS', 'Customers currently hold units of this product. Try again after reservations clear.');
    p.isArchived = true; p.isActive = false; await p.save();
    return res.json({ archived: true, message: 'Product has stock history, so it was archived instead of deleted.' });
  }
  await p.deleteOne();
  res.json({ deleted: true });
}));

/* ---------------- coupons ---------------- */
router.get('/coupons', asyncHandler(async (_req, res) => res.json({ coupons: await Coupon.find().sort({ createdAt: -1 }).lean() })));
router.post('/coupons', validate({ body: couponCreate }), asyncHandler(async (req, res) => res.status(201).json({ coupon: await Coupon.create(req.body) })));
router.patch('/coupons/:id', idParam, validate({ body: couponUpdate }), asyncHandler(async (req, res) => {
  const c = await Coupon.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
  if (!c) throw new AppError(404, 'NOT_FOUND', 'Coupon not found.');
  res.json({ coupon: c });
}));
router.delete('/coupons/:id', idParam, asyncHandler(async (req, res) => {
  const c = await Coupon.findById(req.params.id);
  if (!c) throw new AppError(404, 'NOT_FOUND', 'Coupon not found.');
  if (c.usedCount > 0) { c.active = false; await c.save(); return res.json({ deactivated: true, message: 'Coupon has been used, so it was deactivated instead of deleted.' }); }
  await c.deleteOne();
  res.json({ deleted: true });
}));

export default router;
