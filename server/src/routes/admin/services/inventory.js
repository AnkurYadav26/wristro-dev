/**
 * Inventory core.
 *
 * Model: every Product has
 *   stockOnHand   physical units in the warehouse
 *   stockReserved units held for in-flight (unpaid) checkouts
 *   sellable      = stockOnHand - stockReserved
 *
 * Concurrency strategy: NO read-then-write. Every change is ONE updateOne /
 * findOneAndUpdate whose filter contains the invariant (e.g. sellable >= qty),
 * so MongoDB's per-document atomicity guarantees two buyers cannot both take
 * the last unit. Multi-item operations are compensated on failure.
 *
 * Reservation lifecycle:  active -> committed   (payment verified)
 *                         active -> released    (payment failed / cancelled)
 *                         active -> expired     (TTL passed; swept by a job)
 * A late payment on an expired/released reservation re-acquires stock if
 * possible; otherwise commit returns { ok:false } so the caller can refund.
 */
import mongoose from 'mongoose';
import env from '../config/env.js';
import { Product } from '../models/Product.js';
import { InventoryMovement, StockReservation, MOVEMENT_TYPES, PurchaseOrder, Counter } from '../models/Inventory.js';
import { AppError } from '../utils/AppError.js';
import { withOptionalTransaction } from '../utils/transaction.js';

const sellable = { $subtract: ['$stockOnHand', '$stockReserved'] };
const canSell = (qty) => ({ $gte: [sellable, qty] });

function mergeItems(items) {
  const m = new Map();
  for (const { productId, quantity } of items) {
    if (!Number.isInteger(quantity) || quantity < 1) throw new AppError(422, 'BAD_QUANTITY', 'Quantity must be a positive whole number.');
    const k = String(productId);
    m.set(k, (m.get(k) ?? 0) + quantity);
  }
  return [...m].map(([productId, quantity]) => ({ productId: new mongoose.Types.ObjectId(productId), quantity }));
}

/* ------------------------------------------------------------------ reservations */

export async function reserveStock({ items, userId, idempotencyKey, ttlMinutes = env.STOCK_RESERVATION_MINUTES }) {
  const merged = mergeItems(items);
  if (idempotencyKey) {
    const existing = await StockReservation.findOne({ idempotencyKey });
    if (existing) return existing;
  }
  let reservation;
  try {
    reservation = await StockReservation.create({
      userId, idempotencyKey, status: 'active',
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      items: merged.map((i) => ({ ...i, held: false })),
    });
  } catch (err) {
    if (err.code === 11000 && idempotencyKey) return StockReservation.findOne({ idempotencyKey });
    throw err;
  }

  try {
    for (const item of reservation.items) {
      const r = await Product.updateOne(
        { _id: item.productId, isActive: true, isArchived: false, $expr: canSell(item.quantity) },
        { $inc: { stockReserved: item.quantity } },
      );
      if (r.modifiedCount !== 1) {
        throw new AppError(409, 'INSUFFICIENT_STOCK', 'One or more items are no longer available in the requested quantity.', { productId: String(item.productId) });
      }
      await StockReservation.updateOne({ _id: reservation._id, 'items._id': item._id }, { $set: { 'items.$.held': true } });
    }
  } catch (err) {
    await settleReservation(reservation._id, 'released'); // compensate whatever was held
    throw err;
  }
  return StockReservation.findById(reservation._id);
}

/** Move an ACTIVE reservation to released/expired and give back the units it held. Idempotent. */
export async function settleReservation(reservationId, finalStatus) {
  const r = await StockReservation.findOneAndUpdate(
    { _id: reservationId, status: 'active' },
    { $set: { status: finalStatus, settledAt: new Date() } },
    { new: false },
  );
  if (!r) return false;
  for (const item of r.items) {
    if (!item.held) continue;
    await Product.updateOne({ _id: item.productId, stockReserved: { $gte: item.quantity } }, { $inc: { stockReserved: -item.quantity } });
  }
  return true;
}
export const releaseReservation = (id) => settleReservation(id, 'released');

/** Background job: expire stale reservations. Safe to run from many processes at once. */
export async function sweepExpiredReservations(limit = 200) {
  const stale = await StockReservation.find({ status: 'active', expiresAt: { $lt: new Date() } }).limit(limit).select('_id');
  let n = 0;
  for (const { _id } of stale) if (await settleReservation(_id, 'expired')) n++;
  return n;
}

/**
 * Convert a reservation into a real sale after payment is VERIFIED server-side.
 * Idempotent: calling twice for the same reservation deducts once.
 * @returns {{ok:true}|{ok:false, reason:'INSUFFICIENT_STOCK'|'NOT_FOUND'|'ALREADY_COMMITTED'|'INVALID_STATE'}}
 */
export async function commitReservation(reservationId, { orderId, actorId } = {}) {
  const claimed = await StockReservation.findOneAndUpdate(
    { _id: reservationId, status: 'active' },
    { $set: { status: 'committed', settledAt: new Date(), orderRef: orderId } },
    { new: true },
  );

  if (claimed) {
    const moves = [];
    for (const item of claimed.items) {
      const after = await Product.findOneAndUpdate(
        { _id: item.productId, stockOnHand: { $gte: item.quantity }, stockReserved: { $gte: item.quantity } },
        { $inc: { stockOnHand: -item.quantity, stockReserved: -item.quantity, soldCount: item.quantity } },
        { new: true },
      );
      if (!after) throw new AppError(500, 'INVARIANT_BROKEN', `Reservation ${reservationId} could not be committed for product ${item.productId}. Run reconcile.`);
      moves.push({ productId: item.productId, type: 'sale', quantity: -item.quantity, onHandAfter: after.stockOnHand,
        reference: { kind: 'order', id: orderId ?? claimed._id }, actorId });
    }
    await InventoryMovement.insertMany(moves);
    return { ok: true };
  }

  // Not active: maybe a duplicate callback, or a late payment on an expired hold.
  const r = await StockReservation.findById(reservationId);
  if (!r) return { ok: false, reason: 'NOT_FOUND' };
  if (r.status === 'committed') return { ok: false, reason: 'ALREADY_COMMITTED' };
  if (!['expired', 'released'].includes(r.status)) return { ok: false, reason: 'INVALID_STATE' };

  const reclaimed = await StockReservation.findOneAndUpdate(
    { _id: reservationId, status: r.status },
    { $set: { status: 'committed', settledAt: new Date(), orderRef: orderId } },
    { new: true },
  );
  if (!reclaimed) return { ok: false, reason: 'ALREADY_COMMITTED' };

  // Take the units straight from sellable stock (no hold exists any more). All-or-nothing.
  const taken = [];
  for (const item of reclaimed.items) {
    const after = await Product.findOneAndUpdate(
      { _id: item.productId, $expr: canSell(item.quantity) },
      { $inc: { stockOnHand: -item.quantity, soldCount: item.quantity } },
      { new: true },
    );
    if (!after) {
      for (const t of taken) await Product.updateOne({ _id: t.productId }, { $inc: { stockOnHand: t.quantity, soldCount: -t.quantity } });
      await StockReservation.updateOne({ _id: reservationId }, { $set: { status: r.status } });
      return { ok: false, reason: 'INSUFFICIENT_STOCK' };
    }
    taken.push({ productId: item.productId, quantity: item.quantity, onHandAfter: after.stockOnHand });
  }
  await InventoryMovement.insertMany(taken.map((t) => ({ productId: t.productId, type: 'sale', quantity: -t.quantity,
    onHandAfter: t.onHandAfter, reference: { kind: 'order', id: orderId ?? reclaimed._id }, note: 'late payment re-acquired stock', actorId })));
  return { ok: true };
}

/** Safety net: rebuild stockReserved from active reservations (fixes drift after crashes). */
export async function reconcileReservedStock() {
  const rows = await StockReservation.aggregate([
    { $match: { status: 'active' } }, { $unwind: '$items' }, { $match: { 'items.held': true } },
    { $group: { _id: '$items.productId', qty: { $sum: '$items.quantity' } } },
  ]);
  const want = new Map(rows.map((r) => [String(r._id), r.qty]));
  const products = await Product.find({ $or: [{ stockReserved: { $gt: 0 } }, { _id: { $in: rows.map((r) => r._id) } }] }).select('stockReserved');
  let fixed = 0;
  for (const p of products) {
    const target = want.get(String(p._id)) ?? 0;
    if (p.stockReserved !== target) {
      await Product.updateOne({ _id: p._id }, { $set: { stockReserved: target } });
      fixed++;
    }
  }
  return { checked: products.length, fixed };
}

/* ------------------------------------------------------------------ manual adjustments */

/**
 * Admin stock change (opening stock, damage, returned goods, corrections).
 * Removing stock can only take units that are not reserved by a customer.
 */
export async function adjustStock({ productId, type, quantity, note, actorId, reference, session }) {
  const sign = MOVEMENT_TYPES[type];
  if (!sign || type === 'sale') throw new AppError(422, 'BAD_TYPE', 'Unsupported stock movement type.');
  if (!Number.isInteger(quantity) || quantity < 1) throw new AppError(422, 'BAD_QUANTITY', 'Quantity must be a positive whole number.');
  const filter = { _id: productId, ...(sign < 0 ? { $expr: canSell(quantity) } : {}) };
  const after = await Product.findOneAndUpdate(filter, { $inc: { stockOnHand: sign * quantity } }, { new: true, session });
  if (!after) {
    const exists = await Product.exists({ _id: productId });
    if (!exists) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    throw new AppError(409, 'INSUFFICIENT_STOCK', 'Cannot remove more units than are currently sellable (reserved units cannot be removed).');
  }
  const [movement] = await InventoryMovement.create([{ productId, type, quantity: sign * quantity, onHandAfter: after.stockOnHand, note, actorId, reference }], { session });
  return { product: after, movement };
}

/* ------------------------------------------------------------------ purchasing */

async function nextPoNumber() {
  const year = new Date().getFullYear();
  const c = await Counter.findOneAndUpdate({ _id: `po-${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `PO-${year}-${String(c.seq).padStart(4, '0')}`;
}

export async function createPurchaseOrder({ supplierId, items, taxesPaise = 0, purchaseDate, paymentStatus, invoiceUrl, notes, actorId }) {
  const ids = [...new Set(items.map((i) => String(i.productId)))];
  if (ids.length !== items.length) throw new AppError(422, 'DUPLICATE_ITEMS', 'List each product once per purchase order.');
  const found = await Product.countDocuments({ _id: { $in: ids } });
  if (found !== ids.length) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'One or more products do not exist.');
  const subtotalPaise = items.reduce((s, i) => s + i.quantity * i.unitCostPaise, 0);
  return PurchaseOrder.create({
    poNumber: await nextPoNumber(), supplierId, items, subtotalPaise, taxesPaise, totalPaise: subtotalPaise + taxesPaise,
    purchaseDate, paymentStatus, invoiceUrl, notes, createdBy: actorId,
  });
}

/**
 * Receive goods against a purchase order: adds stock, updates the weighted-average
 * cost atomically, and writes the movement, all in one transaction where supported.
 * Optimistic check on receivedQuantity prevents receiving the same delivery twice.
 */
export async function receivePurchaseOrder(poId, receipts, actorId) {
  return withOptionalTransaction(async (session) => {
    const po = await PurchaseOrder.findById(poId).session(session ?? null);
    if (!po) throw new AppError(404, 'PO_NOT_FOUND', 'Purchase order not found.');
    if (po.status === 'cancelled') throw new AppError(409, 'PO_CANCELLED', 'This purchase order is cancelled.');

    for (const { productId, quantity } of receipts) {
      if (!Number.isInteger(quantity) || quantity < 1) throw new AppError(422, 'BAD_QUANTITY', 'Received quantity must be a positive whole number.');
      const line = po.items.find((i) => String(i.productId) === String(productId));
      if (!line) throw new AppError(422, 'NOT_ON_PO', 'That product is not on this purchase order.');
      if (line.receivedQuantity + quantity > line.quantity) {
        throw new AppError(409, 'OVER_RECEIPT', `Only ${line.quantity - line.receivedQuantity} unit(s) are still outstanding for this line.`);
      }
      const bumped = await PurchaseOrder.updateOne(
        { _id: po._id, items: { $elemMatch: { productId: line.productId, receivedQuantity: line.receivedQuantity } } },
        { $inc: { 'items.$.receivedQuantity': quantity } }, { session },
      );
      if (bumped.modifiedCount !== 1) throw new AppError(409, 'CONFLICT', 'This purchase order changed while receiving. Please retry.');

      // Atomic: stock += qty and weighted-average cost recomputed from the document's own current values.
      const after = await Product.findOneAndUpdate({ _id: productId }, [{
        $set: {
          purchaseCostPaise: { $toLong: { $round: [{ $divide: [
            { $add: [{ $multiply: ['$stockOnHand', '$purchaseCostPaise'] }, quantity * line.unitCostPaise] },
            { $add: ['$stockOnHand', quantity] },
          ] }, 0] } },
          stockOnHand: { $add: ['$stockOnHand', quantity] },
        },
      }], { new: true, session });
      if (!after) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
      await InventoryMovement.create([{ productId, type: 'purchase_in', quantity, onHandAfter: after.stockOnHand,
        reference: { kind: 'purchase_order', id: po._id }, note: po.poNumber, actorId }], { session });
    }

    const fresh = await PurchaseOrder.findById(po._id).session(session ?? null);
    const allIn = fresh.items.every((i) => i.receivedQuantity >= i.quantity);
    const anyIn = fresh.items.some((i) => i.receivedQuantity > 0);
    fresh.status = allIn ? 'received' : anyIn ? 'partial' : 'ordered';
    await fresh.save({ session });
    return fresh;
  });
}

/* ------------------------------------------------------------------ reporting */

const sellingPriceExpr = { $round: [{ $divide: [{ $multiply: ['$mrpPaise', { $subtract: [100, '$discountPercent'] }] }, 100] }, 0] };

export async function inventorySummary() {
  const [s] = await Product.aggregate([
    { $match: { isArchived: false } },
    { $group: {
      _id: null,
      totalProducts: { $sum: 1 },
      totalUnits: { $sum: '$stockOnHand' },
      reservedUnits: { $sum: '$stockReserved' },
      purchaseValuePaise: { $sum: { $multiply: ['$stockOnHand', '$purchaseCostPaise'] } },
      sellingValuePaise: { $sum: { $multiply: ['$stockOnHand', sellingPriceExpr] } },
      lowStockProducts: { $sum: { $cond: [{ $and: [{ $gt: [sellable, 0] }, { $lte: [sellable, '$lowStockThreshold'] }] }, 1, 0] } },
      outOfStockProducts: { $sum: { $cond: [{ $lte: [sellable, 0] }, 1, 0] } },
    } },
    { $project: { _id: 0 } },
  ]);
  const base = s ?? { totalProducts: 0, totalUnits: 0, reservedUnits: 0, purchaseValuePaise: 0, sellingValuePaise: 0, lowStockProducts: 0, outOfStockProducts: 0 };
  return { ...base, availableUnits: base.totalUnits - base.reservedUnits };
}

export const lowStockProducts = () =>
  Product.find({ isArchived: false, isActive: true, $expr: { $lte: [sellable, '$lowStockThreshold'] } })
    .select('name sku brand stockOnHand stockReserved lowStockThreshold').sort({ stockOnHand: 1 }).lean();
