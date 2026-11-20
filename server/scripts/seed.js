/**
 * npm run seed         -> categories, WATCH60 coupon, admin user (from ADMIN_* env vars)
 * npm run seed:demo    -> also 3 clearly-labelled PLACEHOLDER products for testing the flow.
 *
 * Demo products use fake brand/prices/images and are flagged isDemo. They are NOT real
 * catalogue data: replace them with verified products (real MRP + source) before launch.
 */
import bcrypt from 'bcrypt';
import env from '../src/config/env.js';
import { connectDb } from '../src/config/db.js';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Category } from '../src/models/Category.js';
import { Product } from '../src/models/Product.js';
import { Coupon } from '../src/models/Coupon.js';
import { slugify } from '../src/utils/misc.js';
import { adjustStock } from '../src/services/inventory.js';

const demo = process.argv.includes('--demo');
await connectDb();

const categories = ['Smart Watches', 'Digital Watches', 'Analog Watches', 'Luxury Watches', 'Sports Watches', "Men's Collection", "Women's Collection"];
for (const [i, name] of categories.entries()) {
  await Category.updateOne({ slug: slugify(name) }, { $setOnInsert: { name, slug: slugify(name), sortOrder: i } }, { upsert: true });
}
console.log(`categories ok (${categories.length})`);

await Coupon.updateOne({ code: 'WATCH60' }, { $setOnInsert: {
  code: 'WATCH60', description: '60% off MRP (replaces the standard 40% discount)', discountPercent: 60, active: true,
  minOrderValuePaise: 0, maxDiscountPaise: null, usageLimit: null, perCustomerLimit: null } }, { upsert: true });
console.log('coupon WATCH60 ok');

if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
  const email = env.ADMIN_EMAIL.toLowerCase();
  const name = env.ADMIN_NAME ?? 'Store Owner';

  // Create the admin, or update it so its credentials always match the env vars.
  await User.findOneAndUpdate(
    { email },
    { $set: { name, role: 'admin', status: 'active', emailVerified: true, passwordHash: await bcrypt.hash(env.ADMIN_PASSWORD, 12) } },
    { upsert: true, setDefaultsOnInsert: true },
  );
  console.log(`admin ready: ${email}`);

  // This is the ONLY admin account — demote any other user that has the admin role.
  const demoted = await User.updateMany({ role: 'admin', email: { $ne: email } }, { $set: { role: 'customer' } });
  if (demoted.modifiedCount) console.log(`demoted ${demoted.modifiedCount} other admin account(s) to customer`);
} else {
  console.log('ADMIN_EMAIL / ADMIN_PASSWORD not set: skipped admin creation');
}

if (demo) {
  const cat = await Category.findOne({ slug: 'smart-watches' });
  const rows = [
    { name: 'DEMO Smart Watch A (placeholder)', sku: 'DEMO-SW-A', mrpPaise: 500000, cost: 150000, qty: 25 },
    { name: 'DEMO Smart Watch B (placeholder)', sku: 'DEMO-SW-B', mrpPaise: 200000, cost: 90000, qty: 4 },
    { name: 'DEMO Smart Watch C (placeholder)', sku: 'DEMO-SW-C', mrpPaise: 300000, cost: 220000, qty: 0 }, // thin margin: WATCH60 must be blocked
  ];
  for (const r of rows) {
    if (await Product.exists({ sku: r.sku })) continue;
    const p = await Product.create({ name: r.name, slug: slugify(r.name), sku: r.sku, brand: 'Demo Brand', categoryId: cat._id, watchType: 'smart',
      mrpPaise: r.mrp ?? r.mrpPaise, purchaseCostPaise: r.cost, discountPercent: 40, isDemo: true,
      description: 'Placeholder product for testing. Not a real item.', mrpSource: { name: 'DEMO - not a real price' } });
    if (r.qty) await adjustStock({ productId: p._id, type: 'opening_stock', quantity: r.qty, note: 'demo seed' });
  }
  console.log('demo products ok');
}
await mongoose.disconnect();
