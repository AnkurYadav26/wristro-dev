import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * A priced, stock-held, address-bound draft of an order. Phase 5 creates the Razorpay order
 * from `totals.payablePaise` and, once payment is VERIFIED, commits the reservation and turns
 * this into a real Order. Prices here are a server-side snapshot: the client never supplies them.
 */
const lineSchema = new Schema({
  _id: false,
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  name: String, sku: String, brand: String, image: String,
  quantity: Number,
  mrpUnitPaise: Number, standardUnitPaise: Number,
  mrpTotalPaise: Number, standardTotalPaise: Number,
  couponSavingPaise: Number, finalTotalPaise: Number,
  gstPercent: Number,
  unitCostPaise: Number, // INTERNAL: cost at time of sale, for profit reporting. Never sent to customers.
});

const sessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['pending', 'paid', 'cancelled', 'expired', 'failed'], default: 'pending' },
  source: { type: String, enum: ['cart', 'buy_now'], required: true },
  idempotencyKey: { type: String },
  reservationId: { type: Schema.Types.ObjectId, ref: 'StockReservation', required: true },
  expiresAt: { type: Date, required: true },
  items: [lineSchema],
  removeFromCart: [{ type: Schema.Types.ObjectId }], // product ids to drop from the cart once paid
  coupon: { couponId: Schema.Types.ObjectId, code: String, savingPaise: Number },
  totals: {
    mrpPaise: Number, standardDiscountPaise: Number, couponDiscountPaise: Number,
    goodsPaise: Number, shippingPaise: Number, gstIncludedPaise: Number, payablePaise: Number,
  },
  address: {
    fullName: String, mobile: String, alternateMobile: String, pincode: String, houseNo: String, buildingName: String,
    street: String, landmark: String, city: String, district: String, state: String, country: String,
  },
  payment: { type: Schema.Types.Mixed }, // reserved for Phase 5 (gateway order id, payment id, signature result)
}, { timestamps: true });

sessionSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
sessionSchema.index({ status: 1, expiresAt: 1 });

sessionSchema.methods.toCustomer = function () {
  const stale = this.status === 'pending' && this.expiresAt < new Date();
  return {
    id: this._id, status: stale ? 'expired' : this.status, source: this.source, expiresAt: this.expiresAt,
    items: this.items.map((l) => ({ productId: l.productId, name: l.name, brand: l.brand, image: l.image, quantity: l.quantity,
      mrpTotalPaise: l.mrpTotalPaise, finalTotalPaise: l.finalTotalPaise, couponSavingPaise: l.couponSavingPaise })),
    coupon: this.coupon?.code ? { code: this.coupon.code, savingPaise: this.coupon.savingPaise } : null,
    totals: this.totals, address: this.address,
    payment: this.payment
      ? { status: this.payment.status ?? null, simulated: this.payment.simulated === true, paymentId: this.payment.gatewayPaymentId ?? null }
      : null,
  };
};
export const CheckoutSession = mongoose.model('CheckoutSession', sessionSchema);
