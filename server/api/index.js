import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDb } from '../src/config/db.js';

const app = createApp();

// Vercel runs this as a serverless function, so there is no `app.listen`. One Mongo
// connection is reused per warm instance; it is opened lazily on the first request so a
// cold database returns a clean 503 instead of crashing the whole deployment.
let dbPromise = null;
function ensureDb() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!dbPromise) {
    dbPromise = connectDb().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export default async function handler(req, res) {
  try {
    await ensureDb();
  } catch (err) {
    console.error('[api] database connection failed', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'DB_UNAVAILABLE', message: 'Service temporarily unavailable. Please try again.' } }));
    return;
  }
  return app(req, res);
}
