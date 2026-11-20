import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../utils/AppError.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { objectId, checkoutBody, idempotencyHeader, paymentVerifyBody } from '../schemas.js';
import { previewCheckout, createSession, getSession, cancelSession } from '../services/checkoutService.js';
import { startPayment, confirmPayment } from '../services/paymentService.js';

const router = Router();
router.use(requireAuth); // login is compulsory before checkout
const idParam = validate({ params: z.object({ id: objectId }) });

/** Price a checkout (nothing is reserved or stored). Use it to render the order summary. */
router.post('/preview', validate({ body: checkoutBody }), asyncHandler(async (req, res) =>
  res.json(await previewCheckout({ ...req.body, userId: req.user._id }))));

/**
 * Start checkout: validates, holds stock, snapshots prices + address. Requires an Idempotency-Key header
 * (a fresh random string per checkout attempt) so retries and double-clicks never create two holds.
 */
router.post('/sessions', validate({ body: checkoutBody }), asyncHandler(async (req, res) => {
  const key = idempotencyHeader.safeParse(req.get('Idempotency-Key'));
  if (!key.success) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', key.error.issues[0]?.message ?? 'Idempotency-Key header is required.');
  const { session, reused } = await createSession({ ...req.body, userId: req.user._id, idempotencyKey: key.data });
  res.status(reused ? 200 : 201).json({ session: session.toCustomer(), reused });
}));

router.get('/sessions/:id', idParam, asyncHandler(async (req, res) =>
  res.json({ session: (await getSession(req.user._id, req.params.id)).toCustomer() })));

router.post('/sessions/:id/cancel', idParam, asyncHandler(async (req, res) =>
  res.json({ session: (await cancelSession(req.user._id, req.params.id)).toCustomer() })));

/** Create (or reuse) a gateway order for this checkout. Returns the params the browser needs to pay. */
router.post('/sessions/:id/pay', idParam, asyncHandler(async (req, res) =>
  res.json(await startPayment(req.user._id, req.params.id))));

/** Verify the payment signature and, only then, commit the stock hold and mark the session paid. */
router.post('/sessions/:id/verify', idParam, validate({ body: paymentVerifyBody }), asyncHandler(async (req, res) => {
  const b = req.body;
  const session = await confirmPayment({
    sessionId: req.params.id, userId: req.user._id, source: 'client', simulated: b.simulated === true,
    orderId: b.razorpay_order_id, paymentId: b.razorpay_payment_id, signature: b.razorpay_signature,
  });
  res.json({ session: session.toCustomer(), paid: true });
}));

export default router;
