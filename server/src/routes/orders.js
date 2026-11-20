import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { objectId } from '../schemas.js';
import { asyncHandler } from '../utils/AppError.js';
import { listCustomerOrders, getCustomerOrder } from '../services/orderService.js';

const router = Router();
router.use(requireAuth); // a customer only ever sees their own orders

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).passthrough();

/** My orders, newest first. */
router.get('/', validate({ query: listQuery }), asyncHandler(async (req, res) =>
  res.json(await listCustomerOrders(req.user._id, req.validatedQuery))));

router.get('/:id', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) =>
  res.json({ order: await getCustomerOrder(req.user._id, req.params.id) })));

export default router;
