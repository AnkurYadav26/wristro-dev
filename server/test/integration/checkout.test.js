/**
 * Integration tests for cart, addresses and checkout sessions (Phase 4).
 * Run with:  npm run test:integration   (needs `npm install`; skipped unless RUN_INTEGRATION=1)
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const suite = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
const PASSWORD = 'Passw0rd-test';

suite('cart, addresses and checkout sessions', () => {
  let mongod, mongoose, request, app, M, inv, checkout;

  before(async () => {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    Object.assign(process.env, {
      NODE_ENV: 'test', MONGODB_URI: mongod.getUri(), JWT_SECRET: 'j'.repeat(40), OTP_SECRET: 'o'.repeat(40),
      CART_MAX_ITEMS: '2', MAX_QTY_PER_LINE: '10', SHIPPING_FLAT_PAISE: '9900', FREE_SHIPPING_ABOVE_PAISE: '99900',
      PINCODE_API_URL: 'http://127.0.0.1:1', // lookups fail fast: checkout must still work without the PIN service
    });
    mongoose = (await import('mongoose')).default;
    await (await import('../../src/config/db.js')).connectDb();
    M = {
      User: (await import('../../src/models/User.js')).User,
      Product: (await import('../../src/models/Product.js')).Product,
      Category: (await import('../../src/models/Category.js')).Category,
      Coupon: (await import('../../src/models/Coupon.js')).Coupon,
      Cart: (await import('../../src/models/Cart.js')).Cart,
      Address: (await import('../../src/models/Address.js')).Address,
      Session: (await import('../../src/models/CheckoutSession.js')).CheckoutSession,
      Reservation: (await import('../../src/models/Inventory.js')).StockReservation,
    };
    inv = await import('../../src/services/inventory.js');
    checkout = await import('../../src/services/checkoutService.js');
    request = (await import('supertest')).default;
    app = (await import('../../src/app.js')).createApp();
  });
  after(async () => { await mongoose?.disconnect(); await mongod?.stop(); });
  beforeEach(async () => {
    await Promise.all(Object.values(M).map((m) => m.deleteMany({})));
  });

  /* ---------- helpers ---------- */
  let n = 0;
  async function mkProduct(over = {}) {
    n++;
    const cat = (await M.Category.findOne()) ?? (await M.Category.create({ name: 'Smart Watches', slug: 'smart-watches' }));
    return M.Product.create({ name: `Watch ${n}`, slug: `watch-${n}`, sku: `W${n}`, brand: 'B', categoryId: cat._id, watchType: 'smart',
      mrpPaise: 500000, purchaseCostPaise: 100000, stockOnHand: 10, ...over });
  }
  async function mkUser(email) {
    const bcrypt = (await import('bcrypt')).default;
    return M.User.create({ name: 'Test User', email, mobile: `98${String(n++).padStart(8, '0')}`.slice(0, 10), emailVerified: true,
      passwordHash: await bcrypt.hash(PASSWORD, 4) });
  }
  async function loginAs(email) {
    const user = await mkUser(email);
    const agent = request.agent(app);
    const r = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return { agent, user };
  }
  const ADDR = { fullName: 'Asha Verma', mobile: '+91 98765 43210', pincode: '134003', houseNo: '12', street: 'Model Town', city: 'Ambala', district: 'Ambala', state: 'Haryana' };
  const key = () => `key_${Math.random().toString(36).slice(2, 12)}`;
  const sellable = async (p) => { const d = await M.Product.findById(p._id); return d.stockOnHand - d.stockReserved; };

  /* ---------- cart ---------- */
  describe('cart', () => {
    test('add, increment, clamp to per-line max, set, remove', async () => {
      const { agent } = await loginAs('a@x.com'); const p = await mkProduct();
      let r = await agent.post('/api/cart/items').send({ productId: String(p._id), quantity: 3 });
      assert.equal(r.status, 201); assert.equal(r.body.items[0].quantity, 3);
      r = await agent.post('/api/cart/items').send({ productId: String(p._id), quantity: 4 });
      assert.equal(r.body.items[0].quantity, 7);
      r = await agent.post('/api/cart/items').send({ productId: String(p._id), quantity: 9 });
      assert.equal(r.body.items[0].quantity, 10, 'clamped at MAX_QTY_PER_LINE');
      r = await agent.put(`/api/cart/items/${p._id}`).send({ quantity: 2 });
      assert.equal(r.body.items[0].quantity, 2);
      assert.equal((await agent.put(`/api/cart/items/${p._id}`).send({ quantity: 11 })).status, 422);
      r = await agent.delete(`/api/cart/items/${p._id}`);
      assert.equal(r.body.items.length, 0);
    });
    test('concurrent adds of the same product do not duplicate the line', async () => {
      const { agent } = await loginAs('b@x.com'); const p = await mkProduct();
      await Promise.all([1, 2, 3, 4].map(() => agent.post('/api/cart/items').send({ productId: String(p._id), quantity: 1 })));
      const cart = await M.Cart.findOne({});
      assert.equal(cart.items.length, 1);
      assert.equal(cart.items[0].quantity, 4);
    });
    test('cart size limit', async () => {
      const { agent } = await loginAs('c@x.com');
      const [p1, p2, p3] = [await mkProduct(), await mkProduct(), await mkProduct()];
      await agent.post('/api/cart/items').send({ productId: String(p1._id) });
      await agent.post('/api/cart/items').send({ productId: String(p2._id) });
      const r = await agent.post('/api/cart/items').send({ productId: String(p3._id) });
      assert.equal(r.status, 409); assert.equal(r.body.error.code, 'CART_FULL');
    });
    test('requires login; shows live prices and flags unavailable products', async () => {
      assert.equal((await request(app).get('/api/cart')).status, 401);
      const { agent } = await loginAs('d@x.com'); const p = await mkProduct(); const q = await mkProduct();
      await agent.post('/api/cart/items').send({ productId: String(p._id), quantity: 1 });
      await agent.post('/api/cart/items').send({ productId: String(q._id), quantity: 1 });
      await M.Product.updateOne({ _id: q._id }, { isActive: false });
      const r = await agent.get('/api/cart');
      assert.equal(r.body.items.find((i) => i.productId === String(q._id)).available, false);
      assert.equal(r.body.pricing.totalPaise, 300000);
    });
  });

  /* ---------- addresses ---------- */
  describe('addresses', () => {
    test('first address becomes default; country is India; mobile is normalised', async () => {
      const { agent } = await loginAs('e@x.com');
      const r = await agent.post('/api/addresses').send(ADDR);
      assert.equal(r.status, 201);
      assert.equal(r.body.address.isDefault, true);
      assert.equal(r.body.address.country, 'India');
      assert.equal(r.body.address.mobile, '9876543210');
    });
    test('rejects bad state, bad PIN, non-India country, unknown fields', async () => {
      const { agent } = await loginAs('f@x.com');
      assert.equal((await agent.post('/api/addresses').send({ ...ADDR, state: 'Narnia' })).status, 422);
      assert.equal((await agent.post('/api/addresses').send({ ...ADDR, pincode: '12345' })).status, 422);
      assert.equal((await agent.post('/api/addresses').send({ ...ADDR, country: 'USA' })).status, 422);
      assert.equal((await agent.post('/api/addresses').send({ ...ADDR, userId: 'x' })).status, 422);
    });
    test('exactly one default; deleting the default promotes another; users cannot touch each other\'s addresses', async () => {
      const { agent } = await loginAs('g@x.com'); const other = await loginAs('h@x.com');
      const a1 = (await agent.post('/api/addresses').send(ADDR)).body.address;
      const a2 = (await agent.post('/api/addresses').send({ ...ADDR, houseNo: '99', isDefault: true })).body.address;
      let list = (await agent.get('/api/addresses')).body.addresses;
      assert.equal(list.filter((a) => a.isDefault).length, 1);
      assert.equal(list.find((a) => a.isDefault)._id, a2._id);
      await agent.delete(`/api/addresses/${a2._id}`);
      list = (await agent.get('/api/addresses')).body.addresses;
      assert.equal(list.length, 1); assert.equal(list[0].isDefault, true); assert.equal(list[0]._id, a1._id);
      assert.equal((await other.agent.patch(`/api/addresses/${a1._id}`).send({ city: 'Hacked' })).status, 404);
      assert.equal((await other.agent.delete(`/api/addresses/${a1._id}`)).status, 404);
    });
  });

  /* ---------- checkout ---------- */
  describe('checkout', () => {
    async function ready(email, productOver = {}, qty = 1) {
      const ctx = await loginAs(email); const p = await mkProduct(productOver);
      await ctx.agent.post('/api/cart/items').send({ productId: String(p._id), quantity: qty });
      const address = (await ctx.agent.post('/api/addresses').send(ADDR)).body.address;
      return { ...ctx, p, address };
    }

    test('preview prices server-side, adds shipping rules, and never reserves stock', async () => {
      await M.Coupon.create({ code: 'WATCH60', discountPercent: 60 });
      const { agent, p, address } = await ready('i@x.com');
      const body = { source: 'cart', addressId: address._id };
      let r = await agent.post('/api/checkout/preview').send(body);
      assert.equal(r.status, 200);
      assert.equal(r.body.goodsPaise, 300000); assert.equal(r.body.shippingPaise, 0); assert.equal(r.body.payablePaise, 300000);
      r = await agent.post('/api/checkout/preview').send({ ...body, couponCode: 'WATCH60' });
      assert.equal(r.body.payablePaise, 200000); assert.equal(r.body.couponDiscountPaise, 100000); assert.equal(r.body.readyToPay, true);
      assert.equal(await sellable(p), 10, 'preview holds nothing');
    });
    test('cheap order pays flat shipping', async () => {
      const { agent, address } = await ready('j@x.com', { mrpPaise: 100000, purchaseCostPaise: 10000 }); // ₹600 goods
      const r = await agent.post('/api/checkout/preview').send({ source: 'cart', addressId: address._id });
      assert.equal(r.body.shippingPaise, 9900); assert.equal(r.body.payablePaise, 60000 + 9900);
    });

    test('session needs Idempotency-Key and an address', async () => {
      const { agent, address } = await ready('k@x.com');
      assert.equal((await agent.post('/api/checkout/sessions').send({ source: 'cart', addressId: address._id })).status, 400);
      const r = await agent.post('/api/checkout/sessions').set('Idempotency-Key', key()).send({ source: 'cart' });
      assert.equal(r.status, 422); assert.equal(r.body.error.code, 'ADDRESS_REQUIRED');
    });
    test('session holds stock, snapshots totals, hides internal cost; retry with same key is a no-op', async () => {
      const { agent, p, address } = await ready('l@x.com', {}, 2);
      const k = key();
      const send = () => agent.post('/api/checkout/sessions').set('Idempotency-Key', k).send({ source: 'cart', addressId: address._id });
      const r1 = await send();
      assert.equal(r1.status, 201);
      assert.equal(r1.body.session.totals.payablePaise, 600000);
      assert.equal(await sellable(p), 8);
      assert.ok(!JSON.stringify(r1.body).includes('unitCostPaise'), 'no internal cost in customer payload');
      const r2 = await send();
      assert.equal(r2.status, 200); assert.equal(r2.body.reused, true); assert.equal(r2.body.session.id, r1.body.session.id);
      assert.equal(await sellable(p), 8, 'no second hold');
    });
    test('parallel double-click creates exactly one session and one hold', async () => {
      const { agent, p, address } = await ready('m@x.com');
      const k = key();
      const rs = await Promise.all([1, 2, 3].map(() => agent.post('/api/checkout/sessions').set('Idempotency-Key', k).send({ source: 'cart', addressId: address._id })));
      assert.ok(rs.every((r) => [200, 201].includes(r.status)), JSON.stringify(rs.map((r) => r.body)));
      assert.equal(new Set(rs.map((r) => r.body.session.id)).size, 1);
      assert.equal(await M.Session.countDocuments({ status: 'pending' }), 1);
      assert.equal(await sellable(p), 9);
    });
    test('a new checkout cancels the previous pending one and frees its stock', async () => {
      const { agent, p, address } = await ready('n@x.com', {}, 3);
      const s1 = (await agent.post('/api/checkout/sessions').set('Idempotency-Key', key()).send({ source: 'cart', addressId: address._id })).body.session;
      await agent.post('/api/checkout/sessions').set('Idempotency-Key', key()).send({ source: 'cart', addressId: address._id });
      assert.equal((await M.Session.findById(s1.id)).status, 'cancelled');
      assert.equal(await sellable(p), 7, 'only the newest hold remains');
    });
    test('cancel releases stock; cancelling twice is rejected', async () => {
      const { agent, p, address } = await ready('o@x.com', {}, 2);
      const s = (await agent.post('/api/checkout/sessions').set('Idempotency-Key', key()).send({ source: 'cart', addressId: address._id })).body.session;
      assert.equal((await agent.post(`/api/checkout/sessions/${s.id}/cancel`)).status, 200);
      assert.equal(await sellable(p), 10);
      assert.equal((await agent.post(`/api/checkout/sessions/${s.id}/cancel`)).status, 409);
    });

    test('Buy Now purchases ONE cart product and leaves the rest of the cart alone', async () => {
      const { agent, p, address } = await ready('p@x.com', {}, 1);
      const q = await mkProduct();
      await agent.post('/api/cart/items').send({ productId: String(q._id), quantity: 1 });
      const r = await agent.post('/api/checkout/sessions').set('Idempotency-Key', key())
        .send({ source: 'buy_now', productId: String(q._id), quantity: 1, addressId: address._id });
      assert.equal(r.status, 201); assert.equal(r.body.session.items.length, 1);
      assert.equal(String(r.body.session.items[0].productId), String(q._id));
      assert.equal(await sellable(q), 9); assert.equal(await sellable(p), 10, 'other cart item untouched');
      assert.equal((await M.Cart.findOne({})).items.length, 2, 'cart is only edited after payment (Phase 5)');
    });
    test('cart subset checkout; cart mode ignores client quantities; unknown items rejected', async () => {
      const { agent, p, address } = await ready('q@x.com', {}, 2);
      const q = await mkProduct(); await agent.post('/api/cart/items').send({ productId: String(q._id), quantity: 1 });
      const sub = await agent.post('/api/checkout/preview').send({ source: 'cart', productIds: [String(p._id)], addressId: address._id });
      assert.equal(sub.body.lines.length, 1); assert.equal(sub.body.lines[0].quantity, 2);
      assert.equal((await agent.post('/api/checkout/preview').send({ source: 'cart', quantity: 1, productId: String(p._id) })).status, 422);
      const stranger = await mkProduct();
      assert.equal((await agent.post('/api/checkout/preview').send({ source: 'cart', productIds: [String(stranger._id)] })).status, 422);
      assert.equal((await agent.post('/api/checkout/preview').send({ source: 'cart', price: 1 })).status, 422);
    });

    test('stock problems and bad coupons block session creation without holding anything', async () => {
      const { agent, p, address } = await ready('r@x.com', { stockOnHand: 1 }, 1);
      await agent.put(`/api/cart/items/${p._id}`).send({ quantity: 2 });
      let r = await agent.post('/api/checkout/sessions').set('Idempotency-Key', key()).send({ source: 'cart', addressId: address._id });
      assert.equal(r.status, 409); assert.equal(r.body.error.code, 'CHECKOUT_PROBLEMS');
      await agent.put(`/api/cart/items/${p._id}`).send({ quantity: 1 });
      r = await agent.post('/api/checkout/sessions').set('Idempotency-Key', key()).send({ source: 'cart', addressId: address._id, couponCode: 'NOPE' });
      assert.equal(r.status, 422); assert.equal(r.body.error.code, 'COUPON_NOT_APPLICABLE');
      assert.equal(await sellable(p), 1);
    });
    test('two shoppers, one unit: exactly one checkout succeeds', async () => {
      const a = await loginAs('s1@x.com'); const b = await loginAs('s2@x.com');
      const p = await mkProduct({ stockOnHand: 1 });
      const addrA = (await a.agent.post('/api/addresses').send(ADDR)).body.address;
      const addrB = (await b.agent.post('/api/addresses').send(ADDR)).body.address;
      for (const x of [a, b]) await x.agent.post('/api/cart/items').send({ productId: String(p._id), quantity: 1 });
      const [ra, rb] = await Promise.all([
        a.agent.post('/api/checkout/sessions').set('Idempotency-Key', key()).send({ source: 'cart', addressId: addrA._id }),
        b.agent.post('/api/checkout/sessions').set('Idempotency-Key', key()).send({ source: 'cart', addressId: addrB._id })]);
      assert.deepEqual([ra.status, rb.status].sort(), [201, 409]);
      assert.equal(await sellable(p), 0);
    });
    test('sessions and addresses are private to their owner', async () => {
      const a = await ready('t1@x.com'); const b = await loginAs('t2@x.com');
      const s = (await a.agent.post('/api/checkout/sessions').set('Idempotency-Key', key()).send({ source: 'cart', addressId: a.address._id })).body.session;
      assert.equal((await b.agent.get(`/api/checkout/sessions/${s.id}`)).status, 404);
      assert.equal((await b.agent.post(`/api/checkout/sessions/${s.id}/cancel`)).status, 404);
      await b.agent.post('/api/cart/items').send({ productId: String(a.p._id), quantity: 1 });
      assert.equal((await b.agent.post('/api/checkout/preview').send({ source: 'cart', addressId: a.address._id })).status, 404, "can't use someone else's address");
    });
    test('abandoned checkout: sweeper frees stock and marks the session expired', async () => {
      const { agent, p, address, user } = await ready('u@x.com', {}, 2);
      const s = (await agent.post('/api/checkout/sessions').set('Idempotency-Key', key()).send({ source: 'cart', addressId: address._id })).body.session;
      await M.Reservation.updateMany({ userId: user._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      await M.Session.updateOne({ _id: s.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal(await inv.sweepExpiredReservations(), 1);
      assert.equal(await checkout.expireStaleSessions(), 1);
      assert.equal(await sellable(p), 10);
      assert.equal((await agent.get(`/api/checkout/sessions/${s.id}`)).body.session.status, 'expired');
    });
  });

  test('GET /api/meta/states lists 28 states and 8 UTs', async () => {
    const r = await request(app).get('/api/meta/states');
    assert.equal(r.body.states.length, 28); assert.equal(r.body.unionTerritories.length, 8);
  });
});
