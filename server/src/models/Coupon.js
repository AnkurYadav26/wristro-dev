import mongoose from 'mongoose';
const { Schema } = mongoose;
const couponSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, match: /^[A-Z0-9_-]{3,30}$/ },
  description: String,
  discountPercent: { type: Number, required: true, min: 1, max: 90 }, // off MRP; replaces the standard discount
  active: { type: Boolean, default: true },
  startsAt: Date,
  expiresAt: Date,
  minOrderValuePaise: { type: Number, default: 0, min: 0 },
  maxDiscountPaise: { type: Number, default: null, min: 0 },   // cap on the coupon's extra saving
  usageLimit: { type: Number, default: null, min: 1 },
  usedCount: { type: Number, default: 0, min: 0 },
  perCustomerLimit: { type: Number, default: null, min: 1 },
  productIds: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
  categoryIds: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
}, { timestamps: true });
export const Coupon = mongoose.model('Coupon', couponSchema);

const redemptionSchema = new Schema({
  couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  orderId: { type: Schema.Types.ObjectId, required: true, unique: true }, // one redemption per order => idempotent
  savingPaise: Number,
}, { timestamps: true });
redemptionSchema.index({ couponId: 1, userId: 1 });
export const CouponRedemption = mongoose.model('CouponRedemption', redemptionSchema);
