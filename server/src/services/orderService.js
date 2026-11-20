/**
 * Order tracking.
 *
 * A paid CheckoutSession becomes an Order exactly once (unique index on `sessionId`, so retries,
 * webhooks and double clicks can never duplicate it). Progress is tracked PER PRODUCT LINE:
 * the admin moves each line through placed → confirmed → shipped → out_for_delivery → delivered
 * and every step keeps the timestamp it happened at. The order-level status is always the
 * least-advanced line, so a "part shipped" order never looks fully shipped.
 */
import { AppError } from '../utils/AppError.js';
import { User } from '../models/User.js';
import { Counter } from '../models/Inventory.js';
import { Order, ORDER_STAGES, STAGE_INDEX, deliveryEstimate } from '../models/Order.js';
import { parsePaging } from '../utils/misc.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function nextOrderNumber() {
  const year = new Date().getFullYear();
  const c = await Counter.findOneAndUpdate({ _id: `order-${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `WRS-${year}-${String(c.seq).padStart(4, '0')}`;
}

/** Recompute the order badge from its lines, keeping the "least advanced wins" rule. */
function refreshOrderStatus(order) {
  const slowest = Math.min(...order.items.map((i) => STAGE_INDEX[i.status]));
  order.status = ORDER_STAGES[slowest];
  order.deliveredAt = order.status === 'delivered'
    ? new Date(Math.max(...order.items.map((i) => i.deliveredAt?.getTime() ?? 0)))
    : null;
}

/**
 * Create the Order for a paid session. Idempotent: returns the existing order when one is already
 * present for the session (a retried /verify, a webhook, or a double click).
 */
export async function createOrderFromSession(session) {
  const existing = await Order.findOne({ sessionId: session._id });
  if (existing) return existing;

  const placedAt = session.payment?.verifiedAt ? new Date(session.payment.verifiedAt) : new Date();
  const orderNumber = await nextOrderNumber();
  const items = session.items.map((l) => ({
    productId: l.productId,
    name: l.name, sku: l.sku, brand: l.brand, image: l.image,
    quantity: l.quantity,
    unitPaise: l.quantity ? Math.round(l.finalTotalPaise / l.quantity) : l.finalTotalPaise,
    totalPaise: l.finalTotalPaise,
    status: 'placed',
    statusHistory: [{ status: 'placed', at: placedAt }],
  }));

  try {
    return await Order.create({
      orderNumber,
      userId: session.userId,
      sessionId: session._id,
      items,
      totals: session.totals,
      coupon: session.coupon?.code ? { code: session.coupon.code, savingPaise: session.coupon.savingPaise } : undefined,
      address: session.address,
      payment: {
        provider: session.payment?.provider, mode: session.payment?.mode,
        simulated: session.payment?.simulated === true,
        gatewayOrderId: session.payment?.gatewayOrderId, gatewayPaymentId: session.payment?.gatewayPaymentId,
        paidAt: placedAt,
      },
      placedAt,
      expectedDeliveryAt: deliveryEstimate(placedAt),
      status: 'placed',
    });
  } catch (err) {
    // A concurrent confirm already inserted it — hand that one back instead of failing the payment.
    if (err?.code === 11000) return Order.findOne({ sessionId: session._id });
    throw err;
  }
}

export async function listCustomerOrders(userId, query = {}) {
  const { page, limit, skip } = parsePaging(query, 50);
  const filter = { userId };
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ placedAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  return { orders: orders.map((o) => o.toCustomer()), page, limit, total };
}

export async function getCustomerOrder(userId, orderId) {
  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  return order.toCustomer();
}

export async function listAdminOrders(query = {}) {
  const { page, limit, skip } = parsePaging(query, 100);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    const users = await User.find({ $or: [{ name: rx }, { email: rx }, { mobile: rx }] }).select('_id').lean();
    filter.$or = [{ orderNumber: rx }, { userId: { $in: users.map((u) => u._id) } }];
  }
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ placedAt: -1 }).skip(skip).limit(limit).populate('userId', 'name email mobile'),
    Order.countDocuments(filter),
  ]);
  return { orders: orders.map((o) => o.toAdmin()), page, limit, total };
}

export async function getAdminOrder(orderId) {
  const order = await Order.findById(orderId).populate('userId', 'name email mobile');
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  return order.toAdmin();
}

/**
 * Move one product line to a new checkpoint (admin action). Rebuilds that line's timeline so the
 * history stays ordered, then re-derives the order-level status from every line.
 */
export async function updateItemStatus({ orderId, itemId, status, note }) {
  const order = await Order.findById(orderId);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  const item = order.items.id(itemId);
  if (!item) throw new AppError(404, 'ITEM_NOT_FOUND', 'That product is not part of this order.');

  if (item.status === status && !note) return order; // nothing to do

  const at = new Date();
  const target = STAGE_INDEX[status];
  // Keep only the steps that happened before this one, then stamp the new step.
  item.statusHistory = item.statusHistory.filter((h) => STAGE_INDEX[h.status] < target);
  item.statusHistory.push({ status, at, note });
  item.status = status;
  item.deliveredAt = status === 'delivered' ? at : null;

  refreshOrderStatus(order);
  order.markModified('items');
  await order.save();
  return order;
}
