import mongoose from 'mongoose';
import env from './env.js';

export async function connectDb(uri = env.MONGODB_URI) {
  mongoose.set('strictQuery', true);
  // NOTE: do not enable mongoose `sanitizeFilter` globally; it would also neutralise our own
  // trusted $expr/$in/$text operators. User input is cleaned by middleware/security.js + zod.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  // Build indexes (unique SKU/slug/email etc. are part of correctness, not just speed)
  await mongoose.syncIndexes();
  return mongoose.connection;
}
