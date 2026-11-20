/**
 * WRISTORA pricing engine. PURE: no database, no I/O, no floats for money.
 * All amounts are integer paise (₹1 = 100 paise).
 *
 * Rules implemented here (and nowhere else):
 *  - Standard price  = MRP minus the product's standard discount (default 40%).
 *  - Coupon price    = MRP minus the coupon's percent. It REPLACES the standard
 *                      discount; it never stacks on top of it.
 *  - Coupon is applied per line, and only to lines that are eligible
 *    (product/category scope, coupon actually cheaper than standard price,
 *    margin guard passes).
 *  - maxDiscountPaise caps the coupon's EXTRA saving versus the standard price.
 */

export const COUPON_REASONS = Object.freeze({
  INACTIVE: 'This coupon is not active.',
  NOT_STARTED: 'This coupon is not valid yet.',
  EXPIRED: 'This coupon has expired.',
  USAGE_LIMIT_REACHED: 'This coupon has reached its usage limit.',
  PER_CUSTOMER_LIMIT_REACHED: 'You have already used this coupon the maximum number of times.',
  LOGIN_REQUIRED: 'Please log in to use this coupon.',
  MIN_ORDER_NOT_MET: 'Your order does not meet the minimum value for this coupon.',
  NO_ELIGIBLE_ITEMS: 'This coupon does not apply to any item in your cart.',
});

const assertPaise = (n, label) => {
  if (!Number.isInteger(n) || n < 0) throw new TypeError(`${label} must be a non-negative integer (paise), got ${n}`);
};

/** MRP minus discount, rounded to the nearest paise. */
export function priceAfterDiscount(mrpPaise, discountPercent) {
  assertPaise(mrpPaise, 'mrpPaise');
  if (!(discountPercent >= 0 && discountPercent <= 100)) throw new RangeError('discountPercent must be 0-100');
  return Math.round((mrpPaise * (100 - discountPercent)) / 100);
}

export const standardUnitPrice = (product) => priceAfterDiscount(product.mrpPaise, product.discountPercent);

/**
 * Margin guard. Selling prices are GST-inclusive, so compare the net-of-GST
 * revenue against cost plus the required minimum margin.
 */
export function meetsMarginGuard(product, unitPricePaise) {
  if (product.allowBelowCostCoupon) return true;
  const gst = product.gstPercent ?? 0;
  const netRevenue = (unitPricePaise * 100) / (100 + gst);
  const floor = (product.purchaseCostPaise ?? 0) * (1 + (product.minMarginPercent ?? 0) / 100);
  return netRevenue >= floor;
}

/** Is the coupon itself usable right now (independent of cart contents)? */
export function checkCouponState(coupon, { now = new Date(), userId = null, userRedemptions = 0 } = {}) {
  if (!coupon || !coupon.active) return 'INACTIVE';
  if (coupon.startsAt && now < new Date(coupon.startsAt)) return 'NOT_STARTED';
  if (coupon.expiresAt && now >= new Date(coupon.expiresAt)) return 'EXPIRED';
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) return 'USAGE_LIMIT_REACHED';
  if (coupon.perCustomerLimit != null) {
    if (!userId) return 'LOGIN_REQUIRED';
    if (userRedemptions >= coupon.perCustomerLimit) return 'PER_CUSTOMER_LIMIT_REACHED';
  }
  return null;
}

const inScope = (coupon, product) => {
  const pIds = (coupon.productIds ?? []).map(String);
  const cIds = (coupon.categoryIds ?? []).map(String);
  if (!pIds.length && !cIds.length) return true;
  return pIds.includes(String(product.id)) || cIds.includes(String(product.categoryId));
};

/**
 * Price a cart.
 * @param {Array<{product: object, quantity: number}>} items
 *   product: { id, categoryId, mrpPaise, discountPercent, purchaseCostPaise,
 *              gstPercent, minMarginPercent, allowBelowCostCoupon }
 * @param {object|null} coupon
 * @param {{now?: Date, userId?: string|null, userRedemptions?: number}} ctx
 */
export function priceCart(items, coupon = null, ctx = {}) {
  const lines = items.map(({ product, quantity }) => {
    if (!Number.isInteger(quantity) || quantity < 1) throw new RangeError('quantity must be a positive integer');
    const normalUnit = standardUnitPrice(product);
    const mrpTotal = product.mrpPaise * quantity;
    const normalTotal = normalUnit * quantity;
    return {
      productId: String(product.id),
      quantity,
      mrpUnitPaise: product.mrpPaise,
      standardUnitPaise: normalUnit,
      mrpTotalPaise: mrpTotal,
      standardTotalPaise: normalTotal,
      couponSavingPaise: 0,
      finalTotalPaise: normalTotal,
      couponApplied: false,
      _product: product,
    };
  });

  const standardSubtotal = lines.reduce((s, l) => s + l.standardTotalPaise, 0);
  const result = {
    lines: [],
    mrpTotalPaise: lines.reduce((s, l) => s + l.mrpTotalPaise, 0),
    standardSubtotalPaise: standardSubtotal,
    standardDiscountPaise: 0,
    couponDiscountPaise: 0,
    totalPaise: 0,
    coupon: null, // { code, applied, reason?, message? }
  };

  if (coupon) {
    const code = coupon.code;
    let reason = checkCouponState(coupon, ctx);

    if (!reason && standardSubtotal < (coupon.minOrderValuePaise ?? 0)) reason = 'MIN_ORDER_NOT_MET';

    let rawSaving = 0;
    const eligible = [];
    if (!reason) {
      for (const line of lines) {
        const p = line._product;
        if (!inScope(coupon, p)) continue;
        const couponUnit = priceAfterDiscount(p.mrpPaise, coupon.discountPercent);
        if (couponUnit >= line.standardUnitPaise) continue; // coupon is not an improvement
        if (!meetsMarginGuard(p, couponUnit)) continue;
        const saving = (line.standardUnitPaise - couponUnit) * line.quantity;
        eligible.push({ line, saving });
        rawSaving += saving;
      }
      if (!eligible.length) reason = 'NO_ELIGIBLE_ITEMS';
    }

    if (reason) {
      result.coupon = { code, applied: false, reason, message: COUPON_REASONS[reason] };
    } else {
      const cap = coupon.maxDiscountPaise ?? Infinity;
      const totalSaving = Math.min(rawSaving, cap);
      // Allocate the (possibly capped) saving across eligible lines, proportionally,
      // giving the rounding remainder to the last line so the lines sum exactly.
      let allocated = 0;
      eligible.forEach(({ line, saving }, i) => {
        const share = i === eligible.length - 1
          ? totalSaving - allocated
          : Math.floor((saving * totalSaving) / rawSaving);
        allocated += share;
        line.couponSavingPaise = share;
        line.finalTotalPaise = line.standardTotalPaise - share;
        line.couponApplied = share > 0;
      });
      result.couponDiscountPaise = totalSaving;
      result.coupon = { code, applied: true, capped: totalSaving < rawSaving, message: `${code} applied.` };
    }
  }

  result.standardDiscountPaise = result.mrpTotalPaise - standardSubtotal;
  result.totalPaise = standardSubtotal - result.couponDiscountPaise;
  result.lines = lines.map(({ _product, ...rest }) => rest);
  return result;
}
