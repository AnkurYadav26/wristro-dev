import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * Delivery checkpoints, in order. Each product line inside an order advances through these
 * independently, so an order can be "part shipped" while other lines wait.
 */
export const ORDER_STAGES = Object.freeze(['placed', 'confirmed', 'shipped', 'out_for_delivery', 'delivered']);
export const STAGE_INDEX = Object.freeze(Object.fromEntries(ORDER_STAGES.map((s, i) => [s, i])));
export const STAGE_LABELS = Object.freeze({
  placed: 'Order Placed Successfully',
  confirmed: 'Order Confirmed',
  shipped: 'Shipped',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered Successfully',
});

/** How many days after placing we promise delivery. The brief allows 3–4 days, 5 at the very most. */
export const DELIVERY_DAYS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

const historySchema = new Schema({
  status: { type: String, enum: ORDER_STAGES, required: true },
  at: { type: Date, required: true },
  note: { type: String, maxlength: 200 },
}, { _id: false });

const orderItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  name: String, sku: String, brand: String, image: String,
  quantity: { type: Number, required: true, min: 1 },
  unitPaise: { type: Number, default: 0 },
  totalPaise: { type: Number, default: 0 },
  status: { type: String, enum: ORDER_STAGES, default: 'placed' },
  statusHistory: { type: [historySchema], default: [] },
  deliveredAt: Date,
});

const orderSchema = new Schema({
  orderNumber: { type: String, unique: true, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // One order per paid checkout session — the unique index makes order creation idempotent.
  sessionId: { type: Schema.Types.ObjectId, ref: 'CheckoutSession', required: true, unique: true },
  items: { type: [orderItemSchema], default: [] },
  totals: {
    mrpPaise: Number, standardDiscountPaise: Number, couponDiscountPaise: Number,
    goodsPaise: Number, shippingPaise: Number, gstIncludedPaise: Number, payablePaise: Number,
  },
  coupon: { code: String, savingPaise: Number },
  address: {
    fullName: String, mobile: String, alternateMobile: String, pincode: String, houseNo: String,
    buildingName: String, street: String, landmark: String, city: String, district: String,
    state: String, country: String,
  },
  payment: { provider: String, mode: String, simulated: Boolean, gatewayOrderId: String, gatewayPaymentId: String, paidAt: Date },
  placedAt: { type: Date, required: true, default: Date.now },
  expectedDeliveryAt: { type: Date, required: true },
  deliveredAt: Date, // set only once every product line is delivered
  // Least-advanced product status — what the order card badge shows. Kept in sync on every item update.
  status: { type: String, enum: ORDER_STAGES, default: 'placed', index: true },
}, { timestamps: true });

orderSchema.index({ userId: 1, placedAt: -1 });
orderSchema.index({ placedAt: -1 });
orderSchema.index({ status: 1, placedAt: -1 });

/** Turn a stored history into the fixed 5-step checklist the UI renders (done flag + timestamp). */
function buildTimeline(item) {
  const byStage = new Map(item.statusHistory.map((h) => [h.status, h]));
  const reached = STAGE_INDEX[item.status];
  return ORDER_STAGES.map((stage, i) => {
    const entry = byStage.get(stage);
    return {
      status: stage,
      label: STAGE_LABELS[stage],
      done: i <= reached,
      at: entry?.at ?? null,
      note: entry?.note ?? null,
    };
  });
}

function itemPublic(item, expectedDeliveryAt) {
  return {
    id: item._id,
    productId: item.productId,
    name: item.name, sku: item.sku, brand: item.brand, image: item.image,
    quantity: item.quantity, unitPaise: item.unitPaise, totalPaise: item.totalPaise,
    status: item.status, statusLabel: STAGE_LABELS[item.status],
    deliveredAt: item.deliveredAt ?? null,
    expectedDeliveryAt,
    timeline: buildTimeline(item),
  };
}

/** Shared shape for both audiences. `customer` is only attached for admin reads. */
orderSchema.methods.toPublic = function () {
  return {
    id: this._id,
    orderNumber: this.orderNumber,
    placedAt: this.placedAt,
    expectedDeliveryAt: this.expectedDeliveryAt,
    deliveredAt: this.deliveredAt ?? null,
    status: this.status,
    statusLabel: STAGE_LABELS[this.status],
    itemCount: this.items.length,
    totalQuantity: this.items.reduce((n, i) => n + (i.quantity || 0), 0),
    items: this.items.map((i) => itemPublic(i, this.expectedDeliveryAt)),
    totals: this.totals,
    coupon: this.coupon?.code ? { code: this.coupon.code, savingPaise: this.coupon.savingPaise } : null,
    address: this.address,
    payment: this.payment
      ? { provider: this.payment.provider ?? null, simulated: this.payment.simulated === true,
          paymentId: this.payment.gatewayPaymentId ?? null, paidAt: this.payment.paidAt ?? null }
      : null,
  };
};

orderSchema.methods.toCustomer = function () {
  return this.toPublic();
};

/** Admin reads populate `userId`; fall back to the delivery address when a user doc is absent. */
orderSchema.methods.toAdmin = function () {
  const out = this.toPublic();
  const u = this.userId && this.userId.email !== undefined ? this.userId : null;
  out.customer = {
    id: u?._id ?? null,
    name: u?.name || out.address?.fullName || 'Unknown customer',
    email: u?.email || null,
    mobile: u?.mobile || out.address?.mobile || null,
  };
  return out;
};

export const Order = mongoose.model('Order', orderSchema);
export const deliveryEstimate = (from) => new Date(new Date(from).getTime() + DELIVERY_DAYS * DAY_MS);
