import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { priceAfterDiscount, priceCart, meetsMarginGuard, checkCouponState } from '../../src/services/pricing.js';

const RS = (n) => n * 100; // rupees -> paise
const product = (over = {}) => ({
  id: 'p1', categoryId: 'c1', mrpPaise: RS(5000), discountPercent: 40,
  purchaseCostPaise: RS(1000), gstPercent: 18, minMarginPercent: 10, allowBelowCostCoupon: false, ...over,
});
const watch60 = (over = {}) => ({
  code: 'WATCH60', discountPercent: 60, active: true, usedCount: 0,
  minOrderValuePaise: 0, maxDiscountPaise: null, usageLimit: null, perCustomerLimit: null,
  productIds: [], categoryIds: [], ...over,
});

describe('standard 40% pricing (spec examples)', () => {
  test('₹2,000 reference -> ₹1,200', () => {
    assert.equal(priceAfterDiscount(RS(2000), 40), RS(1200));
  });
  test('cart without coupon uses standard price', () => {
    const r = priceCart([{ product: product({ mrpPaise: RS(2000) }), quantity: 1 }]);
    assert.equal(r.totalPaise, RS(1200));
    assert.equal(r.standardDiscountPaise, RS(800));
    assert.equal(r.couponDiscountPaise, 0);
    assert.equal(r.coupon, null);
  });
  test('rounds to nearest paisa and never returns floats', () => {
    const v = priceAfterDiscount(99999, 40);
    assert.ok(Number.isInteger(v));
    assert.equal(v, 59999);
  });
  test('rejects float or negative paise', () => {
    assert.throws(() => priceAfterDiscount(10.5, 40), TypeError);
    assert.throws(() => priceAfterDiscount(-1, 40), TypeError);
  });
  test('rejects bad quantity', () => {
    assert.throws(() => priceCart([{ product: product(), quantity: 0 }]), RangeError);
    assert.throws(() => priceCart([{ product: product(), quantity: 1.5 }]), RangeError);
  });
});

describe('WATCH60 (spec example)', () => {
  test('₹5,000 reference: normal ₹3,000, WATCH60 ₹2,000', () => {
    const normal = priceCart([{ product: product(), quantity: 1 }]);
    assert.equal(normal.totalPaise, RS(3000));
    const withCoupon = priceCart([{ product: product(), quantity: 1 }], watch60());
    assert.equal(withCoupon.totalPaise, RS(2000));
    assert.equal(withCoupon.couponDiscountPaise, RS(1000));
    assert.equal(withCoupon.coupon.applied, true);
  });
  test('REPLACES the 40% discount; does not stack (would be ₹1,200 if stacked)', () => {
    const r = priceCart([{ product: product(), quantity: 1 }], watch60());
    assert.notEqual(r.totalPaise, RS(1200));
    assert.equal(r.totalPaise, r.mrpTotalPaise - Math.round(r.mrpTotalPaise * 0.6));
  });
  test('quantity multiplies', () => {
    const r = priceCart([{ product: product(), quantity: 3 }], watch60());
    assert.equal(r.totalPaise, RS(6000));
  });
  test('a coupon smaller than the standard discount never makes the price worse', () => {
    const r = priceCart([{ product: product(), quantity: 1 }], watch60({ discountPercent: 30 }));
    assert.equal(r.coupon.applied, false);
    assert.equal(r.coupon.reason, 'NO_ELIGIBLE_ITEMS');
    assert.equal(r.totalPaise, RS(3000));
  });
});

describe('coupon eligibility', () => {
  const cart = [{ product: product(), quantity: 1 }];
  const reasonOf = (coupon, ctx) => priceCart(cart, coupon, ctx).coupon.reason;

  test('inactive', () => assert.equal(reasonOf(watch60({ active: false })), 'INACTIVE'));
  test('not started', () =>
    assert.equal(reasonOf(watch60({ startsAt: new Date('2030-01-01') }), { now: new Date('2026-01-01') }), 'NOT_STARTED'));
  test('expired (expiry instant is exclusive)', () => {
    const c = watch60({ expiresAt: new Date('2026-06-01T00:00:00Z') });
    assert.equal(reasonOf(c, { now: new Date('2026-06-01T00:00:00Z') }), 'EXPIRED');
    assert.equal(priceCart(cart, c, { now: new Date('2026-05-31T23:59:59Z') }).coupon.applied, true);
  });
  test('global usage limit', () =>
    assert.equal(reasonOf(watch60({ usageLimit: 100, usedCount: 100 })), 'USAGE_LIMIT_REACHED'));
  test('per-customer limit needs login, then enforces count', () => {
    const c = watch60({ perCustomerLimit: 1 });
    assert.equal(reasonOf(c, {}), 'LOGIN_REQUIRED');
    assert.equal(reasonOf(c, { userId: 'u1', userRedemptions: 1 }), 'PER_CUSTOMER_LIMIT_REACHED');
    assert.equal(priceCart(cart, c, { userId: 'u1', userRedemptions: 0 }).coupon.applied, true);
  });
  test('minimum order is measured on the standard-discounted subtotal', () => {
    assert.equal(reasonOf(watch60({ minOrderValuePaise: RS(3001) })), 'MIN_ORDER_NOT_MET');
    assert.equal(priceCart(cart, watch60({ minOrderValuePaise: RS(3000) })).coupon.applied, true);
  });
  test('checkCouponState handles null coupon', () => assert.equal(checkCouponState(null), 'INACTIVE'));
});

describe('scope: products and categories', () => {
  test('category-restricted coupon only discounts matching lines', () => {
    const items = [
      { product: product({ id: 'a', categoryId: 'smart' }), quantity: 1 },
      { product: product({ id: 'b', categoryId: 'analog' }), quantity: 1 },
    ];
    const r = priceCart(items, watch60({ categoryIds: ['smart'] }));
    assert.equal(r.lines[0].couponApplied, true);
    assert.equal(r.lines[0].finalTotalPaise, RS(2000));
    assert.equal(r.lines[1].couponApplied, false);
    assert.equal(r.lines[1].finalTotalPaise, RS(3000));
    assert.equal(r.totalPaise, RS(5000));
  });
  test('no eligible lines -> not applied', () => {
    const r = priceCart([{ product: product({ categoryId: 'analog' }), quantity: 1 }], watch60({ categoryIds: ['smart'] }));
    assert.equal(r.coupon.reason, 'NO_ELIGIBLE_ITEMS');
  });
  test('product-id scope works', () => {
    const r = priceCart([{ product: product({ id: 'x' }), quantity: 1 }], watch60({ productIds: ['x'] }));
    assert.equal(r.coupon.applied, true);
  });
});

describe('maximum discount cap', () => {
  test('caps the extra saving and flags it', () => {
    const r = priceCart([{ product: product(), quantity: 1 }], watch60({ maxDiscountPaise: RS(400) }));
    assert.equal(r.couponDiscountPaise, RS(400));
    assert.equal(r.totalPaise, RS(2600));
    assert.equal(r.coupon.capped, true);
  });
  test('capped saving is allocated exactly across lines (no paisa lost)', () => {
    const items = [
      { product: product({ id: 'a', mrpPaise: 100003, purchaseCostPaise: 0 }), quantity: 1 },
      { product: product({ id: 'b', mrpPaise: 250007, purchaseCostPaise: 0 }), quantity: 2 },
      { product: product({ id: 'c', mrpPaise: 333331, purchaseCostPaise: 0 }), quantity: 1 },
    ];
    const r = priceCart(items, watch60({ maxDiscountPaise: 99999 }));
    assert.ok(r.lines.every((l) => l.couponApplied), 'all three lines eligible');
    const sum = r.lines.reduce((s, l) => s + l.couponSavingPaise, 0);
    assert.equal(sum, 99999);
    assert.equal(r.couponDiscountPaise, 99999);
    assert.equal(r.totalPaise, r.lines.reduce((s, l) => s + l.finalTotalPaise, 0));
  });
});

describe('margin guard (stops WATCH60 selling below cost)', () => {
  test('blocks coupon when net-of-GST price is under cost + minimum margin', () => {
    const risky = product({ purchaseCostPaise: RS(2500) }); // coupon price ₹2,000 < cost
    assert.equal(meetsMarginGuard(risky, RS(2000)), false);
    const r = priceCart([{ product: risky, quantity: 1 }], watch60());
    assert.equal(r.coupon.applied, false);
    assert.equal(r.totalPaise, RS(3000)); // falls back to standard price, still profitable
  });
  test('allows it when the owner explicitly opts in', () => {
    const r = priceCart([{ product: product({ purchaseCostPaise: RS(2500), allowBelowCostCoupon: true }), quantity: 1 }], watch60());
    assert.equal(r.totalPaise, RS(2000));
  });
  test('healthy margin passes', () => assert.equal(meetsMarginGuard(product(), RS(2000)), true));
  test('guard is applied per line in a mixed cart', () => {
    const items = [
      { product: product({ id: 'ok' }), quantity: 1 },
      { product: product({ id: 'risky', purchaseCostPaise: RS(2500) }), quantity: 1 },
    ];
    const r = priceCart(items, watch60());
    assert.equal(r.lines[0].couponApplied, true);
    assert.equal(r.lines[1].couponApplied, false);
  });
});
