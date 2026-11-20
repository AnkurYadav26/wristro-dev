/**
 * The ONLY place that turns a client's cart into prices. The client sends
 * {productId, quantity} and an optional coupon code; every amount is computed here
 * from database values. Anything price-like the client sends is ignored.
 */
import { Product } from '../models/Product.js';
import env from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { priceCart } from './pricing.js';
import { findCouponByCode, countUserRedemptions } from './couponService.js';

/** Same as quoteCart but also returns the loaded product documents (for order snapshots). */
export async function quoteCartDetailed({ items, couponCode, userId = null, now = new Date() }) {
  const ids = [...new Set(items.map((i) => String(i.productId)))];
  const products = await Product.find({ _id: { $in: ids }, isActive: true, isArchived: false });
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const merged = new Map();
  for (const { productId, quantity } of items) merged.set(String(productId), (merged.get(String(productId)) ?? 0) + quantity);

  const problems = [];
  const cart = [];
  for (const [id, quantity] of merged) {
    const p = byId.get(id);
    if (!p) { problems.push({ productId: id, code: 'UNAVAILABLE', message: 'This product is no longer available.' }); continue; }
    if (quantity > env.MAX_QTY_PER_LINE) problems.push({ productId: id, code: 'MAX_QTY', message: `You can buy at most ${env.MAX_QTY_PER_LINE} of this item per order.` });
    const available = p.stockOnHand - p.stockReserved;
    if (quantity > available) problems.push({ productId: id, code: 'INSUFFICIENT_STOCK', message: available > 0 ? `Only ${available} left in stock.` : 'Out of stock.', available: Math.max(0, available) });
    cart.push({ product: { id: String(p._id), categoryId: String(p.categoryId), mrpPaise: p.mrpPaise, discountPercent: p.discountPercent,
      purchaseCostPaise: p.purchaseCostPaise, gstPercent: p.gstPercent, minMarginPercent: p.minMarginPercent, allowBelowCostCoupon: p.allowBelowCostCoupon }, quantity });
  }
  if (!cart.length) throw new AppError(422, 'EMPTY_CART', 'No purchasable items in the request.', problems);

  let coupon = null;
  if (couponCode) {
    coupon = await findCouponByCode(couponCode);
    if (!coupon) {
      coupon = { code: String(couponCode).trim().toUpperCase(), active: false }; // reported as "not active", no enumeration of codes
    }
  }
  const userRedemptions = coupon?._id ? await countUserRedemptions(coupon._id, userId) : 0;
  const priced = priceCart(cart, coupon, { now, userId, userRedemptions });
  const quote = { ...priced, problems, purchasable: problems.length === 0, couponId: coupon?._id ? String(coupon._id) : null };
  return { quote, products: byId };
}

export async function quoteCart(args) {
  return (await quoteCartDetailed(args)).quote;
}
