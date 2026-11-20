import mongoose from 'mongoose';

const unsupported = (err) =>
  err?.code === 20 || /Transaction numbers are only allowed|replica set|IllegalOperation/i.test(err?.message ?? '');

/**
 * Runs `fn(session)` in a transaction when MongoDB supports it (replica set / Atlas).
 * On a standalone server (typical local dev) it falls back to `fn(undefined)`.
 * The fallback only triggers when the *first* operation is rejected, before any write.
 */
export async function withOptionalTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    try {
      let result;
      await session.withTransaction(async () => { result = await fn(session); });
      return result;
    } catch (err) {
      if (unsupported(err)) return await fn(undefined);
      throw err;
    }
  } finally {
    await session.endSession();
  }
}
