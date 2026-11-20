import express, { Router } from 'express';
import { asyncHandler } from '../utils/AppError.js';
import { handleRazorpayWebhook } from '../services/paymentService.js';

const router = Router();

/**
 * Gateway webhooks. Mounted BEFORE express.json() so the RAW body is available for
 * signature verification, and before the origin/auth middleware (Razorpay calls server-to-server).
 */
router.post('/razorpay', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) =>
  res.json(await handleRazorpayWebhook({ rawBody: req.body, signature: req.get('x-razorpay-signature') }))));

export default router;
