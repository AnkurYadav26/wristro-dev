/**
 * Checkout = price + validate + hold stock + snapshot. No payment here (Phase 5).
 *
 * Every number comes from the database via the pricing engine. The client chooses WHAT to buy
 * (cart contents live server-side; Buy Now sends one product + quantity), a coupon code and an address id.
 */
import { Cart } from '../models/Cart.js';
import { Address, ADDRESS_FIELDS } from '../models/Address.js';
import { CheckoutSession } from '../models/CheckoutSession.js';
import { AppError } from '../utils/AppError.js';
import { quoteCartDetailed } from './quoteService.js';
import { checkoutTotals } from './checkoutTotals.js';
import { shippingCfg } from './cartService.js';
import { reserveStock, releaseReservation } from './inventory.js';

async function resolveItems({ userId, source, productId, quantity, productIds }) {
  if (source === 'buy_now') {
    return { items: [{ productId: String(productId), quantity }], removeFromCart: [String(productId)] };
  }
  const cart = await Cart.findOne({ userId }).lean();
  let items = cart?.items ?? [];
  if (productIds?.length) {
    const wanted = new Set(productIds.map(String));
    const missing = [...wanted].filter((id) => !items.some((i) => String(i.productId) === id));
    if (missing.length) throw new AppError(422, 'NOT_IN_CART', 'Some selected items are not in your cart.', { productIds: missing });
    items = items.filter((i) => wanted.has(String(i.productId)));
  }
  if (!items.length) throw new AppError(422, 'EMPTY_CART', 'Your cart is empty.');
  return { items: items.map((i) => ({ productId: String(i.productId), quantity: i.quantity })), removeFromCart: items.map((i) => String(i.productId)) };
}

export async function buildCheckout({ userId, source, productId, quantity, productIds, couponCode, addressId }) {
  const { items, removeFromCart } = await resolveItems({ userId, source, productId, quantity, productIds });
  const { quote, products } = await quoteCartDetailed({ items, couponCode, userId });
  const gst = Object.fromEntries(quote.lines.map((l) => [l.productId, products.get(l.productId)?.gstPercent ?? 0]));
  const totals = checkoutTotals(quote, gst, shippingCfg());
  const address = addressId ? await Address.findOne({ _id: addressId, userId }) : null;
  if (addressId && !address) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Delivery address not found.');
  const lines = quote.lines.map((l) => {
    const p = products.get(l.productId);
    return { productId: l.productId, name: p.name, sku: p.sku, brand: p.brand, image: p.images?.[0]?.url, quantity: l.quantity,
      mrpUnitPaise: l.mrpUnitPaise, standardUnitPaise: l.standardUnitPaise, mrpTotalPaise: l.mrpTotalPaise, standardTotalPaise: l.standardTotalPaise,
      couponSavingPaise: l.couponSavingPaise, finalTotalPaise: l.finalTotalPaise, gstPercent: p.gstPercent, unitCostPaise: p.purchaseCostPaise };
  });
  return { items, removeFromCart, quote, totals, lines, address, couponRequested: Boolean(couponCode) };
}

/** Customer-facing preview: no stock is held and nothing is stored. */
export async function previewCheckout(input) {
  const b = await buildCheckout(input);
  const q = b.quote;
  return {
    lines: q.lines.map((l) => ({ ...l, ...pick(b.lines.find((x) => x.productId === l.productId), ['name', 'brand', 'image']) })),
    mrpTotalPaise: q.mrpTotalPaise, standardDiscountPaise: q.standardDiscountPaise, couponDiscountPaise: q.couponDiscountPaise,
    goodsPaise: b.totals.goodsPaise, shippingPaise: b.totals.shippingPaise, gstIncludedPaise: b.totals.gstIncludedPaise, payablePaise: b.totals.payablePaise,
    freeShippingAbovePaise: shippingCfg().freeAbovePaise,
    coupon: q.coupon, problems: q.problems, purchasable: q.purchasable,
    address: b.address ? summarizeAddress(b.address) : null,
    readyToPay: q.purchasable && Boolean(b.address) && (!b.couponRequested || q.coupon?.applied === true),
  };
}

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
const summarizeAddress = (a) => pick(a, ['fullName', 'mobile', 'pincode', 'city', 'state']);

/**
 * Cancel the user's other pending sessions (and give their stock back) so one person can't hoard stock.
 * Sessions with the same idempotency key are the SAME attempt (a retry or double-click), so they are left alone.
 */
export async function cancelPendingSessions(userId, exceptKey) {
  const pending = await CheckoutSession.find({ userId, status: 'pending', ...(exceptKey ? { idempotencyKey: { $ne: exceptKey } } : {}) });
  for (const s of pending) {
    const done = await CheckoutSession.findOneAndUpdate({ _id: s._id, status: 'pending' }, { $set: { status: 'cancelled' } });
    if (done) await releaseReservation(s.reservationId);
  }
}

export async function createSession({ idempotencyKey, ...input }) {
  const { userId } = input;
  const existing = await CheckoutSession.findOne({ userId, idempotencyKey });
  if (existing) return { session: existing, reused: true };

  const b = await buildCheckout(input);
  if (!b.address) throw new AppError(422, 'ADDRESS_REQUIRED', 'Choose a delivery address to continue.');
  if (!b.quote.purchasable) throw new AppError(409, 'CHECKOUT_PROBLEMS', 'Some items cannot be purchased as requested.', b.quote.problems);
  if (b.couponRequested && !b.quote.coupon?.applied) {
    throw new AppError(422, 'COUPON_NOT_APPLICABLE', b.quote.coupon?.message ?? 'This coupon cannot be applied.', { reason: b.quote.coupon?.reason });
  }

  await cancelPendingSessions(userId, idempotencyKey);
  const reservation = await reserveStock({ items: b.items, userId, idempotencyKey: `chk:${userId}:${idempotencyKey}` });
  const q = b.quote;
  try {
    const session = await CheckoutSession.create({
      userId, source: input.source, idempotencyKey, reservationId: reservation._id, expiresAt: reservation.expiresAt,
      items: b.lines, removeFromCart: b.removeFromCart,
      coupon: q.coupon?.applied ? { couponId: q.couponId, code: q.coupon.code, savingPaise: q.couponDiscountPaise } : undefined,
      totals: { mrpPaise: q.mrpTotalPaise, standardDiscountPaise: q.standardDiscountPaise, couponDiscountPaise: q.couponDiscountPaise,
        goodsPaise: b.totals.goodsPaise, shippingPaise: b.totals.shippingPaise, gstIncludedPaise: b.totals.gstIncludedPaise, payablePaise: b.totals.payablePaise },
      address: pick(b.address, ADDRESS_FIELDS),
    });
    return { session, reused: false };
  } catch (err) {
    if (err.code === 11000) {
      // A parallel request with the same key won. It owns the (shared) reservation, so do NOT release it.
      const winner = await CheckoutSession.findOne({ userId, idempotencyKey });
      if (winner) return { session: winner, reused: true };
    }
    await releaseReservation(reservation._id);
    throw err;
  }
}

export async function getSession(userId, id) {
  const s = await CheckoutSession.findOne({ _id: id, userId });
  if (!s) throw new AppError(404, 'SESSION_NOT_FOUND', 'Checkout session not found.');
  return s;
}

export async function cancelSession(userId, id) {
  const s = await CheckoutSession.findOneAndUpdate({ _id: id, userId, status: 'pending' }, { $set: { status: 'cancelled' } }, { new: true });
  if (!s) {
    const existing = await getSession(userId, id);
    throw new AppError(409, 'NOT_CANCELLABLE', `This checkout is already ${existing.status}.`);
  }
  await releaseReservation(s.reservationId);
  return s;
}

/** Background job companion to sweepExpiredReservations (which frees the stock). */
export async function expireStaleSessions() {
  const r = await CheckoutSession.updateMany({ status: 'pending', expiresAt: { $lt: new Date() } }, { $set: { status: 'expired' } });
  return r.modifiedCount;
}
