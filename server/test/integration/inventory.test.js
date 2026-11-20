/**
 * Integration tests for the parts that need a real MongoDB: atomic stock, reservations,
 * purchase receipts, coupon redemption and the quote endpoint.
 *
 *   npm install && npm run test:integration
 *
 * Uses mongodb-memory-server (downloads a MongoDB binary on first run) as a one-node
 * replica set, so the transaction path in receivePurchaseOrder is exercised too.
 * Skipped unless RUN_INTEGRATION=1.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const RUN = process.env.RUN_INTEGRATION === '1';
const suite = RUN ? describe : describe.skip;

suite('inventory & pricing against MongoDB', () => {
  let mongod, mongoose, Product, Category, Coupon, Supplier, StockReservation, InventoryMovement, inv, couponSvc, request, app;

  before(async () => {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    Object.assign(process.env, {
      NODE_ENV: 'test', MONGODB_URI: mongod.getUri(), JWT_SECRET: 'j'.repeat(40), OTP_SECRET: 'o'.repeat(40),
    });
    mongoose = (await import('mongoose')).default;
    await (await import('../../src/config/db.js')).connectDb();
    ({ Product } = await import('../../src/models/Product.js'));
    ({ Category } = await import('../../src/models/Category.js'));
    ({ Coupon } = await import('../../src/models/Coupon.js'));
    ({ Supplier } = await import('../../src/models/Supplier.js'));
    ({ StockReservation, InventoryMovement } = await import('../../src/models/Inventory.js'));
    inv = await import('../../src/services/inventory.js');
    couponSvc = await import('../../src/services/couponService.js');
    request = (await import('supertest')).default;
    app = (await import('../../src/app.js')).createApp();
  });
  after(async () => { await mongoose?.disconnect(); await mongod?.stop(); });
  beforeEach(async () => {
    await Promise.all([Product, Category, Coupon, Supplier, StockReservation, InventoryMovement].map((m) => m.deleteMany({})));
    await mongoose.connection.collection('purchaseorders').deleteMany({});
  });

  let n = 0;
  async function mkProduct(over = {}) {
    n++;
    const cat = (await Category.findOne()) ?? (await Category.create({ name: 'Smart Watches', slug: 'smart-watches' }));
    return Product.create({ name: `P${n}`, slug: `p${n}`, sku: `SKU${n}`, brand: 'B', categoryId: cat._id, watchType: 'smart',
      mrpPaise: 500000, purchaseCostPaise: 100000, stockOnHand: 0, ...over });
  }
  const fresh = (p) => Product.findById(p._id);

  test('10 buyers race for the LAST unit: exactly one wins, no oversell', async () => {
    const p = await mkProduct({ stockOnHand: 1 });
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) =>
      inv.reserveStock({ items: [{ productId: p._id, quantity: 1 }], idempotencyKey: `k${i}` })));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'INSUFFICIENT_STOCK'));
    const after = await fresh(p);
    assert.equal(after.stockReserved, 1);
    assert.equal(after.stockOnHand, 1);
  });

  test('multi-item reservation is all-or-nothing', async () => {
    const a = await mkProduct({ stockOnHand: 5 });
    const b = await mkProduct({ stockOnHand: 0 });
    await assert.rejects(inv.reserveStock({ items: [{ productId: a._id, quantity: 2 }, { productId: b._id, quantity: 1 }] }), { code: 'INSUFFICIENT_STOCK' });
    assert.equal((await fresh(a)).stockReserved, 0, 'units held for A must be given back');
  });

  test('same idempotency key returns the same reservation (no double hold)', async () => {
    const p = await mkProduct({ stockOnHand: 5 });
    const [r1, r2] = await Promise.all([1, 2].map(() => inv.reserveStock({ items: [{ productId: p._id, quantity: 2 }], idempotencyKey: 'same' })));
    assert.equal(String(r1._id), String(r2._id));
    assert.equal((await fresh(p)).stockReserved, 2);
  });

  test('commit deducts exactly once and records one sale movement', async () => {
    const p = await mkProduct({ stockOnHand: 5 });
    const r = await inv.reserveStock({ items: [{ productId: p._id, quantity: 2 }] });
    const results = await Promise.all([inv.commitReservation(r._id), inv.commitReservation(r._id)]);
    assert.equal(results.filter((x) => x.ok).length, 1);
    const after = await fresh(p);
    assert.equal(after.stockOnHand, 3);
    assert.equal(after.stockReserved, 0);
    assert.equal(after.soldCount, 2);
    assert.equal(await InventoryMovement.countDocuments({ productId: p._id, type: 'sale' }), 1);
  });

  test('release gives stock back; sweep expires stale holds', async () => {
    const p = await mkProduct({ stockOnHand: 3 });
    const r1 = await inv.reserveStock({ items: [{ productId: p._id, quantity: 1 }] });
    await inv.releaseReservation(r1._id);
    assert.equal((await fresh(p)).stockReserved, 0);
    const r2 = await inv.reserveStock({ items: [{ productId: p._id, quantity: 2 }], ttlMinutes: 1 });
    await StockReservation.updateOne({ _id: r2._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await inv.sweepExpiredReservations(), 1);
    assert.equal((await fresh(p)).stockReserved, 0);
    assert.equal(await inv.releaseReservation(r2._id), false, 'already settled: second release is a no-op');
  });

  test('late payment on an expired hold re-acquires stock if available, else asks for a refund', async () => {
    const p = await mkProduct({ stockOnHand: 1 });
    const r = await inv.reserveStock({ items: [{ productId: p._id, quantity: 1 }] });
    await inv.releaseReservation(r._id);
    assert.deepEqual(await inv.commitReservation(r._id), { ok: true });
    assert.equal((await fresh(p)).stockOnHand, 0);

    const q = await mkProduct({ stockOnHand: 1 });
    const r2 = await inv.reserveStock({ items: [{ productId: q._id, quantity: 1 }] });
    await inv.releaseReservation(r2._id);
    await inv.reserveStock({ items: [{ productId: q._id, quantity: 1 }] }); // someone else took it
    assert.deepEqual(await inv.commitReservation(r2._id), { ok: false, reason: 'INSUFFICIENT_STOCK' });
  });

  test('admin cannot remove units a customer has reserved', async () => {
    const p = await mkProduct({ stockOnHand: 5 });
    await inv.reserveStock({ items: [{ productId: p._id, quantity: 4 }] });
    await assert.rejects(inv.adjustStock({ productId: p._id, type: 'damage_out', quantity: 2, note: 'x' }), { code: 'INSUFFICIENT_STOCK' });
    const ok = await inv.adjustStock({ productId: p._id, type: 'damage_out', quantity: 1, note: 'cracked' });
    assert.equal(ok.product.stockOnHand, 4);
  });

  test('purchase receipt adds stock, averages cost, blocks over/duplicate receipt', async () => {
    const p = await mkProduct({ stockOnHand: 10, purchaseCostPaise: 100000 });
    const s = await Supplier.create({ name: 'Acme Traders' });
    const po = await inv.createPurchaseOrder({ supplierId: s._id, items: [{ productId: p._id, quantity: 10, unitCostPaise: 200000 }], taxesPaise: 36000 });
    assert.match(po.poNumber, /^PO-\d{4}-0001$/);
    assert.equal(po.totalPaise, 10 * 200000 + 36000);
    const done = await inv.receivePurchaseOrder(po._id, [{ productId: p._id, quantity: 10 }]);
    assert.equal(done.status, 'received');
    const after = await fresh(p);
    assert.equal(after.stockOnHand, 20);
    assert.equal(after.purchaseCostPaise, 150000); // (10×1000 + 10×2000) / 20 = ₹1,500
    await assert.rejects(inv.receivePurchaseOrder(po._id, [{ productId: p._id, quantity: 1 }]), { code: 'OVER_RECEIPT' });
    assert.equal((await fresh(p)).stockOnHand, 20);
  });

  test('reconcile repairs drifted reserved counters', async () => {
    const p = await mkProduct({ stockOnHand: 5 });
    await inv.reserveStock({ items: [{ productId: p._id, quantity: 2 }] });
    await Product.updateOne({ _id: p._id }, { $set: { stockReserved: 4 } }); // simulate drift
    const out = await inv.reconcileReservedStock();
    assert.equal(out.fixed, 1);
    assert.equal((await fresh(p)).stockReserved, 2);
  });

  test('coupon usage limit holds under concurrency and is idempotent per order', async () => {
    const c = await Coupon.create({ code: 'ONEONLY', discountPercent: 60, usageLimit: 1 });
    const user = new mongoose.Types.ObjectId();
    const results = await Promise.all([1, 2, 3].map(() =>
      couponSvc.redeemCoupon({ couponId: c._id, userId: user, orderId: new mongoose.Types.ObjectId(), savingPaise: 100 })));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await Coupon.findById(c._id)).usedCount, 1);
    const sameOrder = new mongoose.Types.ObjectId();
    const c2 = await Coupon.create({ code: 'MANY', discountPercent: 60 });
    await couponSvc.redeemCoupon({ couponId: c2._id, userId: user, orderId: sameOrder });
    await couponSvc.redeemCoupon({ couponId: c2._id, userId: user, orderId: sameOrder });
    assert.equal((await Coupon.findById(c2._id)).usedCount, 1);
  });

  test('POST /api/pricing/quote ignores client prices and applies WATCH60 server-side', async () => {
    await Coupon.create({ code: 'WATCH60', discountPercent: 60 });
    const p = await mkProduct({ stockOnHand: 5 }); // MRP ₹5,000, cost ₹1,000
    const plain = await request(app).post('/api/pricing/quote').send({ items: [{ productId: String(p._id), quantity: 1 }] });
    assert.equal(plain.status, 200);
    assert.equal(plain.body.totalPaise, 300000);
    const promo = await request(app).post('/api/pricing/quote').send({ items: [{ productId: String(p._id), quantity: 1 }], couponCode: 'watch60' });
    assert.equal(promo.body.totalPaise, 200000);
    const tamper = await request(app).post('/api/pricing/quote').send({ items: [{ productId: String(p._id), quantity: 1, price: 1 }] });
    assert.equal(tamper.status, 422, 'unknown keys (like price) are rejected, not trusted');
    const tooMany = await request(app).post('/api/pricing/quote').send({ items: [{ productId: String(p._id), quantity: 6 }] });
    assert.equal(tooMany.body.purchasable, false);
  });

  test('admin routes reject anonymous users', async () => {
    assert.equal((await request(app).get('/api/admin/inventory/summary')).status, 401);
  });
});
