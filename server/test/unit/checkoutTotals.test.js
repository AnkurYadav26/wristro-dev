import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shippingFor, gstContained, checkoutTotals } from '../../src/services/checkoutTotals.js';
import { priceCart } from '../../src/services/pricing.js';

const CFG = { flatPaise: 9900, freeAbovePaise: 99900 };
const RS = (n) => n * 100;

describe('shipping', () => {
  test('flat fee below threshold, free at or above it', () => {
    assert.equal(shippingFor(RS(500), CFG), 9900);
    assert.equal(shippingFor(99899, CFG), 9900);
    assert.equal(shippingFor(99900, CFG), 0);
    assert.equal(shippingFor(RS(5000), CFG), 0);
  });
  test('no shipping on an empty basket; supports "always free" and "always flat"', () => {
    assert.equal(shippingFor(0, CFG), 0);
    assert.equal(shippingFor(RS(10), { flatPaise: 0, freeAbovePaise: null }), 0);
    assert.equal(shippingFor(RS(10000), { flatPaise: 5000, freeAbovePaise: null }), 5000);
  });
});

describe('GST contained in an inclusive price', () => {
  test('₹1,180 at 18% contains ₹180', () => assert.equal(gstContained(RS(1180), 18), RS(180)));
  test('0% contains nothing; result is an integer', () => {
    assert.equal(gstContained(RS(1000), 0), 0);
    assert.ok(Number.isInteger(gstContained(99999, 18)));
  });
});

describe('checkoutTotals', () => {
  const product = (id, mrp, over = {}) => ({ id, categoryId: 'c', mrpPaise: mrp, discountPercent: 40, purchaseCostPaise: 0, gstPercent: 18, minMarginPercent: 0, allowBelowCostCoupon: false, ...over });
  test('adds shipping to goods; GST is informational and not added again', () => {
    const q = priceCart([{ product: product('a', RS(1000)), quantity: 1 }]); // ₹600 goods
    const t = checkoutTotals(q, { a: 18 }, CFG);
    assert.equal(t.goodsPaise, RS(600));
    assert.equal(t.shippingPaise, 9900);
    assert.equal(t.payablePaise, RS(600) + 9900);
    assert.equal(t.gstIncludedPaise, gstContained(RS(600), 18));
  });
  test('WATCH60 can pull a cart under the free-shipping line, and shipping follows the DISCOUNTED amount', () => {
    const items = [{ product: product('a', RS(2000)), quantity: 1 }]; // std ₹1,200 (free ship); WATCH60 ₹800 (pays ship)
    const watch60 = { code: 'WATCH60', discountPercent: 60, active: true, usedCount: 0 };
    assert.equal(checkoutTotals(priceCart(items), { a: 18 }, CFG).shippingPaise, 0);
    const withCoupon = checkoutTotals(priceCart(items, watch60), { a: 18 }, CFG);
    assert.equal(withCoupon.goodsPaise, RS(800));
    assert.equal(withCoupon.shippingPaise, 9900);
  });
});
