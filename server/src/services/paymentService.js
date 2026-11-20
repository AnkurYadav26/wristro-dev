/**
 * Payments (Phase 5) — Razorpay.
 *
 * Flow: a CheckoutSession holds stock. `startPayment` creates a gateway order for
 * `totals.payablePaise`; `confirmPayment` verifies the gateway signature and, ONLY then,
 * commits the reservation (turning the hold into a real sale) and marks the session paid.
 *
 * With no API keys configured, development uses a SIMULATED gateway so the whole flow is
 * testable without a Razorpay account. Production refuses to simulate (payments return 503).
 *
 * Razorpay is called over its REST API with fetch, so no SDK dependency is required.
 */
import crypto from 'node:crypto';
import env from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { CheckoutSession } from '../models/CheckoutSession.js';
import { commitReservation } from './inventory.js';
import { removeFromCart } from './cartService.js';
import { createOrderFromSession } from './orderService.js';

const RAZORPAY_API = 'https://api.razorpay.com/v1';
const keysConfigured = () => Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

/** 'live' when keys exist · 'simulated' in dev without keys · 'unconfigured' in prod without keys. */
export function paymentMode() {
  if (keysConfigured()) return 'live';
  return env.isProd ? 'unconfigured' : 'simulated';
}

function requireConfigured() {
  const mode = paymentMode();
  if (mode === 'unconfigured') throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Online payments are not configured.');
  return mode;
}

async function razorpayRequest(path, body) {
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(`${RAZORPAY_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError(502, 'GATEWAY_ERROR', data?.error?.description ?? 'The payment gateway rejected the request.');
  return data;
}

const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

async function createGatewayOrder({ amountPaise, receipt }) {
  if (paymentMode() === 'simulated') return { id: `sim_order_${crypto.randomBytes(10).toString('hex')}` };
  return razorpayRequest('/orders', { amount: amountPaise, currency: 'INR', receipt, payment_capture: 1 });
}

/**
 * Create (or reuse) a gateway order for a pending session.
 * @returns checkout params for the browser: { mode, simulated, keyId, orderId, amountPaise, currency }
 */
export async function startPayment(userId, sessionId) {
  const mode = requireConfigured();
  const session = await CheckoutSession.findOne({ _id: sessionId, userId });
  if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Checkout session not found.');
  if (session.status === 'paid') throw new AppError(409, 'ALREADY_PAID', 'This checkout is already paid.');
  if (session.status !== 'pending') throw new AppError(409, 'NOT_PAYABLE', `This checkout is ${session.status}.`);
  if (session.expiresAt < new Date()) throw new AppError(409, 'SESSION_EXPIRED', 'This checkout has expired. Start again to re-hold stock.');

  let orderId = session.payment?.gatewayOrderId;
  if (!orderId) {
    const order = await createGatewayOrder({ amountPaise: session.totals.payablePaise, receipt: String(session._id) });
    orderId = order.id;
    session.payment = {
      provider: 'razorpay', mode, gatewayOrderId: orderId, amountPaise: session.totals.payablePaise,
      currency: 'INR', simulated: mode === 'simulated', status: 'created', createdAt: new Date(),
    };
    await session.save();
  }
  return { mode, simulated: mode === 'simulated', keyId: env.RAZORPAY_KEY_ID || null,
    orderId, amountPaise: session.totals.payablePaise, currency: 'INR' };
}

function verifySignature({ mode, orderId, paymentId, signature }) {
  if (mode === 'simulated') return { ok: true };
  if (!orderId || !paymentId || !signature) return { ok: false };
  const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return { ok: safeEqual(expected, signature) };
}

/**
 * Verify a payment and, if genuine, convert the stock hold into a sale.
 * Idempotent: a duplicate client retry or webhook returns the already-paid session unchanged.
 * @param {'client'|'webhook'} source  client = browser callback (signature verified); webhook = already authenticated by HMAC.
 */
export async function confirmPayment({ sessionId, userId, orderId, paymentId, signature, simulated, source = 'client' }) {
  const mode = paymentMode();
  const filter = sessionId ? { _id: sessionId, ...(userId ? { userId } : {}) } : { 'payment.gatewayOrderId': orderId };
  const session = await CheckoutSession.findOne(filter);
  if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Checkout session not found.');
  // Already paid: make sure the tracking order exists (covers a retried callback or webhook),
  // then hand the session back unchanged.
  if (session.status === 'paid') {
    await createOrderFromSession(session);
    return session;
  }
  if (session.status !== 'pending') throw new AppError(409, 'NOT_PAYABLE', `This checkout is ${session.status}.`);
  if (orderId && session.payment?.gatewayOrderId !== orderId) {
    throw new AppError(400, 'ORDER_MISMATCH', 'That payment does not belong to this checkout.');
  }

  if (source === 'client') {
    if (mode === 'simulated') {
      if (simulated !== true) throw new AppError(400, 'SIMULATION_FLAG_REQUIRED', 'Send { "simulated": true } to confirm a simulated payment.');
    } else {
      const verdict = verifySignature({ mode, orderId: orderId ?? session.payment?.gatewayOrderId, paymentId, signature });
      if (!verdict.ok) throw new AppError(400, 'PAYMENT_NOT_VERIFIED', 'Payment signature verification failed.');
    }
  }

  const committed = await commitReservation(session.reservationId, { orderId: session._id });
  if (!committed.ok && committed.reason !== 'ALREADY_COMMITTED') {
    await CheckoutSession.updateOne({ _id: session._id, status: 'pending' },
      { $set: { status: 'failed', 'payment.status': 'failed', 'payment.reason': committed.reason } });
    throw new AppError(409, 'PAYMENT_RECONCILE', 'Payment was captured but stock could not be reserved. A refund is required.');
  }

  const done = await CheckoutSession.findOneAndUpdate(
    { _id: session._id, status: 'pending' },
    { $set: { status: 'paid', 'payment.status': 'captured',
      'payment.gatewayPaymentId': paymentId ?? null, 'payment.verifiedAt': new Date(), 'payment.source': source } },
    { new: true });
  const finalSession = done ?? await CheckoutSession.findById(session._id);
  if (finalSession.removeFromCart?.length) await removeFromCart(finalSession.userId, finalSession.removeFromCart);
  // The sale is real now — open the customer's tracking order. Idempotent on sessionId.
  await createOrderFromSession(finalSession);
  return finalSession;
}

/**
 * Razorpay webhook (mounted with express.raw BEFORE express.json). Acts as the source of truth
 * for payments that complete after the browser closes (e.g. UPI). Authenticated by HMAC over the raw body.
 */
export async function handleRazorpayWebhook({ rawBody, signature }) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw new AppError(503, 'WEBHOOK_UNCONFIGURED', 'RAZORPAY_WEBHOOK_SECRET is not configured.');
  }
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  if (!signature || !safeEqual(expected, signature)) throw new AppError(400, 'BAD_SIGNATURE', 'Invalid webhook signature.');

  const event = JSON.parse(rawBody.toString('utf8') || '{}');
  const payment = event?.payload?.payment?.entity;
  if ((event?.event === 'payment.captured' || event?.event === 'order.paid') && payment?.order_id) {
    await confirmPayment({ orderId: payment.order_id, paymentId: payment.id, source: 'webhook' });
  }
  return { ok: true };
}
