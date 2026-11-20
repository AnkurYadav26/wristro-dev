import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/AppError.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { objectId, cartAddBody, cartSetBody } from '../schemas.js';
import { addToCart, setCartQuantity, removeFromCart, clearCart, cartView } from '../services/cartService.js';

const router = Router();
router.use(requireAuth);
const couponQuery = z.object({ coupon: z.string().trim().max(30).optional() }).passthrough();
const pid = validate({ params: z.object({ productId: objectId }) });

router.get('/', validate({ query: couponQuery }), asyncHandler(async (req, res) =>
  res.json(await cartView(req.user._id, req.validatedQuery.coupon))));

router.post('/items', validate({ body: cartAddBody }), asyncHandler(async (req, res) => {
  await addToCart(req.user._id, req.body.productId, req.body.quantity);
  res.status(201).json(await cartView(req.user._id));
}));
router.put('/items/:productId', pid, validate({ body: cartSetBody }), asyncHandler(async (req, res) => {
  await setCartQuantity(req.user._id, req.params.productId, req.body.quantity);
  res.json(await cartView(req.user._id));
}));
router.delete('/items/:productId', pid, asyncHandler(async (req, res) => {
  await removeFromCart(req.user._id, [req.params.productId]);
  res.json(await cartView(req.user._id));
}));
router.delete('/', asyncHandler(async (req, res) => { await clearCart(req.user._id); res.json(await cartView(req.user._id)); }));

export default router;
