import mongoose from 'mongoose';
import env from './config/env.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { sweepExpiredReservations, reconcileReservedStock } from './services/inventory.js';
import { expireStaleSessions } from './services/checkoutService.js';

await connectDb();
const app = createApp();
const server = app.listen(env.PORT, () => console.log(`WRISTORA API listening on :${env.PORT} (${env.NODE_ENV})`));

// Release stock held by abandoned checkouts. Safe with multiple instances (each release is an atomic claim).
const sweep = setInterval(async () => {
  try {
    const n = await sweepExpiredReservations(); if (n) console.log(`[inventory] released ${n} expired reservation(s)`);
    await expireStaleSessions();
  }
  catch (e) { console.error('[inventory] sweep failed', e); }
}, 60_000);
// Nightly drift repair for stockReserved.
const reconcile = setInterval(async () => {
  try { const r = await reconcileReservedStock(); if (r.fixed) console.warn('[inventory] reconcile fixed', r); }
  catch (e) { console.error('[inventory] reconcile failed', e); }
}, 24 * 3600_000);

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  clearInterval(sweep); clearInterval(reconcile);
  server.close(async () => { await mongoose.disconnect(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
