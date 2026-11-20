import { Coupon, CouponRedemption } from '../models/Coupon.js';

export const findCouponByCode = (code) => Coupon.findOne({ code: String(code).trim().toUpperCase() }).lean();

export const countUserRedemptions = (couponId, userId) =>
  userId ? CouponRedemption.countDocuments({ couponId, userId }) : 0;

/**
 * Called by the order flow (Phase 5) AFTER payment is verified.
 * Atomically takes one unit of the global usage limit and records a per-order redemption.
 * Idempotent per orderId. Returns false if the limit was exhausted in the meantime.
 */
export async function redeemCoupon({ couponId, userId, orderId, savingPaise }) {
  if (await CouponRedemption.exists({ orderId })) return true;
  const taken = await Coupon.findOneAndUpdate(
    { _id: couponId, $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] },
    { $inc: { usedCount: 1 } },
  );
  if (!taken) return false;
  try {
    await CouponRedemption.create({ couponId, userId, orderId, savingPaise });
  } catch (err) {
    await Coupon.updateOne({ _id: couponId }, { $inc: { usedCount: -1 } });
    if (err.code === 11000) return true; // concurrent duplicate of the same order
    throw err;
  }
  return true;
}
