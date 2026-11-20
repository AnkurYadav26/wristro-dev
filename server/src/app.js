import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import env from './config/env.js';
import { sanitizeInput, originCheck, apiLimiter } from './middleware/security.js';
import { notFound, errorHandler } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import adminRoutes from './routes/admin/index.js';
import cartRoutes from './routes/cart.js';
import addressRoutes from './routes/addresses.js';
import checkoutRoutes from './routes/checkout.js';
import orderRoutes from './routes/orders.js';
import webhookRoutes from './routes/webhooks.js';
import metaRoutes from './routes/meta.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  app.use(cors({ origin: env.clientOrigins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
  // Payment webhooks need the RAW body to verify their signature, so they mount BEFORE express.json().
  app.use('/api/payments/webhook', webhookRoutes);
  // Admin image uploads arrive as base64 data URLs, so this path gets a much larger body limit.
  // The admin form auto-resizes images before sending, so payloads are normally well under 1 MB;
  // the headroom is only for images the browser cannot re-encode (e.g. animated GIFs / HEIC).
  app.use('/api/admin/uploads', express.json({ limit: '36mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(sanitizeInput);

  app.get('/api/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

  app.use('/api', apiLimiter, originCheck);
  app.use('/api/auth', authRoutes);
  app.use('/api/cart', cartRoutes);
  app.use('/api/addresses', addressRoutes);
  app.use('/api/checkout', checkoutRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api', metaRoutes);
  app.use('/api', catalogRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
