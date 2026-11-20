import { Cart } from '../models/Cart.js';
import { Product } from '../models/Product.js';
import env from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { quoteCartDetailed } from './quoteService.js';
import { checkoutTotals } from './checkoutTotals.js';

export const shippingCfg = () => ({ flatPaise: env.SHIPPING_FLAT_PAISE, freeAbovePaise: env.FREE_SHIPPING_ABOVE_PAISE });

async function assertPurchasable(productId) {
  if (!(await Product.exists({ _id: productId, isActive: true, isArchived: false }))) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'This product is not available.');
  }
}

/**
 * Add `quantity` to the line (clamped to the per-line maximum). Single-statement updates, no read-modify-write.
 * If two requests race to create the same line, the loser retries and increments the line the winner created.
 */
export async function addToCart(userId, productId, quantity) {
  await assertPurchasable(productId);
  const MAX = env.MAX_QTY_PER_LINE;
  const qty = Math.min(quantity, MAX);

  for (let attempt = 0; attempt < 3; attempt++) {
    const inc = await Cart.updateOne({ userId, items: { $elemMatch: { productId, quantity: { $lte: MAX - qty } } } }, { $inc: { 'items.$.quantity': qty } });
    if (inc.modifiedCount) return;
    const clamp = await Cart.updateOne({ userId, 'items.productId': productId }, { $set: { 'items.$.quantity': MAX } });
    if (clamp.matchedCount) return;

    try {
      // MongoDB rejects $expr inside an upsert filter, so create/ensure the cart first...
      await Cart.updateOne({ userId }, { $setOnInsert: { userId, items: [] } }, { upsert: true });
      // ...then push the line, but only while the cart still has room for another product.
      const push = await Cart.updateOne(
        { userId, 'items.productId': { $ne: productId }, $expr: { $lt: [{ $size: '$items' }, env.CART_MAX_ITEMS] } },
        { $push: { items: { productId, quantity: qty } } });
      if (push.modifiedCount) return;
      // Nothing pushed: the cart is full, or the line appeared concurrently: loop and increment it.
      const cart = await Cart.findOne({ userId }).lean();
      if (!cart?.items.some((i) => String(i.productId) === String(productId))) {
        throw new AppError(409, 'CART_FULL', `Your cart can hold at most ${env.CART_MAX_ITEMS} different items.`);
      }
    } catch (err) {
      if (err.code !== 11000) throw err; // a concurrent request created the cart first — retry the loop.
    }
  }
  throw new AppError(409, 'CONFLICT', 'Your cart is being updated elsewhere. Please try again.');
}

export async function setCartQuantity(userId, productId, quantity) {
  if (quantity > env.MAX_QTY_PER_LINE) throw new AppError(422, 'MAX_QTY', `You can buy at most ${env.MAX_QTY_PER_LINE} of this item per order.`);
  const r = await Cart.updateOne({ userId, 'items.productId': productId }, { $set: { 'items.$.quantity': quantity } });
  if (!r.matchedCount) throw new AppError(404, 'NOT_IN_CART', 'That item is not in your cart.');
}

export const removeFromCart = (userId, productIds) =>
  Cart.updateOne({ userId }, { $pull: { items: { productId: { $in: productIds } } } });

export const clearCart = (userId) => Cart.updateOne({ userId }, { $set: { items: [] } });

/** Cart as the UI needs it: each line, availability, live server-side prices, estimated totals. */
export async function cartView(userId, couponCode) {
  const cart = await Cart.findOne({ userId }).lean();
  const entries = cart?.items ?? [];
  const docs = entries.length ? await Product.find({ _id: { $in: entries.map((e) => e.productId) } }) : [];
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const live = entries.filter((e) => { const p = byId.get(String(e.productId)); return p && p.isActive && !p.isArchived; });

  let quote = null; let totals = null;
  if (live.length) {
    quote = (await quoteCartDetailed({ items: live.map((e) => ({ productId: String(e.productId), quantity: e.quantity })), couponCode, userId })).quote;
    totals = checkoutTotals(quote, Object.fromEntries(live.map((e) => [String(e.productId), byId.get(String(e.productId)).gstPercent])), shippingCfg());
  }
  const lineByProduct = new Map((quote?.lines ?? []).map((l) => [l.productId, l]));
  const problemByProduct = new Map((quote?.problems ?? []).map((p) => [p.productId, p]));

  const items = entries.map((e) => {
    const id = String(e.productId); const p = byId.get(id);
    if (!p || !p.isActive || p.isArchived) return { productId: id, quantity: e.quantity, available: false, issue: { code: 'UNAVAILABLE', message: 'This product is no longer available.' } };
    const pub = p.toPublic(env.MAX_QTY_PER_LINE);
    return { productId: id, quantity: e.quantity, available: !problemByProduct.has(id), issue: problemByProduct.get(id) ?? null,
      product: { name: pub.name, slug: pub.slug, brand: pub.brand, image: pub.images?.[0]?.url ?? null, mrpPaise: pub.mrpPaise,
        sellingPricePaise: pub.sellingPricePaise, stockStatus: pub.stockStatus, maxPurchasable: pub.maxPurchasable },
      line: lineByProduct.get(id) ?? null };
  });
  const { couponId, lines, problems, ...pricing } = quote ?? {};
  return { items, itemCount: entries.reduce((s, e) => s + e.quantity, 0), pricing: quote ? pricing : null, totals };
}
