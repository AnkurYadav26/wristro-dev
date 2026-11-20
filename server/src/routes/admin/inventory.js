import { Router } from 'express';
import { z } from 'zod';
import { Supplier } from '../../models/Supplier.js';
import { Admin } from '../../models/Admin.js';
import { User } from '../../models/User.js';
import { PurchaseOrder, InventoryMovement, MOVEMENT_TYPES } from '../../models/Inventory.js';
import { AppError, asyncHandler } from '../../utils/AppError.js';
import { validate } from '../../middleware/validate.js';
import { objectId, paise } from '../../schemas.js';
import { parsePaging } from '../../utils/misc.js';
import * as inv from '../../services/inventory.js';

const router = Router();
const idParam = validate({ params: z.object({ id: objectId }) });

/* ---------------- suppliers ---------------- */
const supplierBody = z.object({
  name: z.string().trim().min(2).max(120), companyName: z.string().trim().max(160).optional(),
  contactPerson: z.string().trim().max(80).optional(), phone: z.string().trim().max(20).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  gstin: z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Invalid GSTIN').optional(),
  address: z.object({ line1: z.string().optional(), line2: z.string().optional(), city: z.string().optional(), state: z.string().optional(), pincode: z.string().regex(/^[1-9]\d{5}$/).optional() }).strict().optional(),
  notes: z.string().max(1000).optional(), isActive: z.boolean().optional(),
}).strict();

router.get('/suppliers', asyncHandler(async (_req, res) => res.json({ suppliers: await Supplier.find().sort({ name: 1 }).lean() })));
router.post('/suppliers', validate({ body: supplierBody }), asyncHandler(async (req, res) => res.status(201).json({ supplier: await Supplier.create(req.body) })));
router.patch('/suppliers/:id', idParam, validate({ body: supplierBody.partial() }), asyncHandler(async (req, res) => {
  const s = await Supplier.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
  if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found.');
  res.json({ supplier: s });
}));
router.delete('/suppliers/:id', idParam, asyncHandler(async (req, res) => {
  if (await PurchaseOrder.exists({ supplierId: req.params.id })) {
    await Supplier.findByIdAndUpdate(req.params.id, { isActive: false });
    return res.json({ deactivated: true, message: 'Supplier has purchase history, so it was deactivated instead of deleted.' });
  }
  await Supplier.findByIdAndDelete(req.params.id);
  res.json({ deleted: true });
}));

/* ---------------- purchase orders ---------------- */
const poBody = z.object({
  supplierId: objectId,
  items: z.array(z.object({ productId: objectId, quantity: z.number().int().min(1).max(100000), unitCostPaise: paise }).strict()).min(1).max(100),
  taxesPaise: paise.optional(), purchaseDate: z.coerce.date().optional(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional(), invoiceUrl: z.string().url().optional(), notes: z.string().max(1000).optional(),
}).strict();

router.post('/purchase-orders', validate({ body: poBody }), asyncHandler(async (req, res) => {
  if (!(await Supplier.exists({ _id: req.body.supplierId }))) throw new AppError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found.');
  res.status(201).json({ purchaseOrder: await inv.createPurchaseOrder({ ...req.body, actorId: req.user._id }) });
}));
router.get('/purchase-orders', validate({ query: z.object({ supplierId: objectId.optional(), status: z.enum(['ordered', 'partial', 'received', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).passthrough() }),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery; const f = {};
    if (q.supplierId) f.supplierId = q.supplierId; if (q.status) f.status = q.status;
    const { skip, limit } = parsePaging(q, 100);
    const [orders, total] = await Promise.all([PurchaseOrder.find(f).sort({ purchaseDate: -1 }).skip(skip).limit(limit).populate('supplierId', 'name').lean(), PurchaseOrder.countDocuments(f)]);
    res.json({ purchaseOrders: orders, total });
  }));
router.get('/purchase-orders/:id', idParam, asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id).populate('supplierId').populate('items.productId', 'name sku').lean();
  if (!po) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found.');
  res.json({ purchaseOrder: po });
}));
router.patch('/purchase-orders/:id', idParam, validate({ body: z.object({ paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional(),
  invoiceUrl: z.string().url().optional(), notes: z.string().max(1000).optional(), status: z.literal('cancelled').optional() }).strict() }),
  asyncHandler(async (req, res) => {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found.');
    if (req.body.status === 'cancelled' && po.items.some((i) => i.receivedQuantity > 0)) throw new AppError(409, 'ALREADY_RECEIVED', 'Goods have already been received against this order.');
    po.set(req.body); await po.save();
    res.json({ purchaseOrder: po });
  }));
router.post('/purchase-orders/:id/receive', idParam, validate({ body: z.object({
  items: z.array(z.object({ productId: objectId, quantity: z.number().int().min(1) }).strict()).min(1)
    .refine((a) => new Set(a.map((i) => i.productId)).size === a.length, 'List each product once per receipt') }).strict() }),
  asyncHandler(async (req, res) => res.json({ purchaseOrder: await inv.receivePurchaseOrder(req.params.id, req.body.items, req.user._id) })));

/* ---------------- stock ---------------- */
router.get('/inventory/summary', asyncHandler(async (_req, res) => res.json({ summary: await inv.inventorySummary() })));
router.get('/inventory/low-stock', asyncHandler(async (_req, res) => res.json({ products: await inv.lowStockProducts() })));

const adjustable = Object.keys(MOVEMENT_TYPES).filter((t) => t !== 'sale' && t !== 'purchase_in');
router.post('/inventory/adjust', validate({ body: z.object({
  productId: objectId, type: z.enum(adjustable), quantity: z.number().int().min(1).max(100000), note: z.string().trim().max(300).optional() }).strict()
  .refine((b) => !['damage_out', 'adjustment_out', 'adjustment_in', 'return_in'].includes(b.type) || Boolean(b.note), { path: ['note'], message: 'A note is required for this movement type.' }) }),
  asyncHandler(async (req, res) => {
    const { product, movement } = await inv.adjustStock({ ...req.body, actorId: req.user._id });
    res.status(201).json({ movement, stockOnHand: product.stockOnHand, stockReserved: product.stockReserved });
  }));
router.get('/inventory/movements', validate({ query: z.object({ productId: objectId.optional(), type: z.enum(Object.keys(MOVEMENT_TYPES)).optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }).passthrough() }),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery; const f = {};
    if (q.productId) f.productId = q.productId; if (q.type) f.type = q.type;
    const { skip, limit } = parsePaging(q, 100);
    const [movements, total] = await Promise.all([InventoryMovement.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('productId', 'name sku').lean(), InventoryMovement.countDocuments(f)]);
    // Admins now live in their own collection, so resolve the actor's name from Admin (new) and
    // User (legacy movements) and attach it to the movement.
    const actorIds = [...new Set(movements.map((m) => m.actorId).filter(Boolean).map(String))];
    if (actorIds.length) {
      const [admins, users] = await Promise.all([
        Admin.find({ _id: { $in: actorIds } }).select('name').lean(),
        User.find({ _id: { $in: actorIds } }).select('name').lean(),
      ]);
      const nameById = new Map([...admins, ...users].map((u) => [String(u._id), u.name]));
      for (const m of movements) if (m.actorId) m.actorId = { _id: m.actorId, name: nameById.get(String(m.actorId)) || null };
    }
    res.json({ movements, total });
  }));
router.post('/inventory/reconcile', asyncHandler(async (_req, res) => res.json(await inv.reconcileReservedStock())));

export default router;
