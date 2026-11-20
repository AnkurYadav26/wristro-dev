import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { objectId } from '../../schemas.js';
import { asyncHandler } from '../../utils/AppError.js';
import { ORDER_STAGES } from '../../models/Order.js';
import { listAdminOrders, getAdminOrder, updateItemStatus } from '../../services/orderService.js';

const router = Router();

const listQuery = z.object({
  q: z.string().trim().max(80).optional(),          // order number, customer name, email or mobile
  status: z.enum(ORDER_STAGES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).passthrough();

/** Every customer order, newest first, with the customer's contact details attached. */
router.get('/orders', validate({ query: listQuery }), asyncHandler(async (req, res) =>
  res.json(await listAdminOrders(req.validatedQuery))));

router.get('/orders/:id', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) =>
  res.json({ order: await getAdminOrder(req.params.id) })));

/** Advance (or correct) one product line's delivery checkpoint. */
router.patch('/orders/:id/items/:itemId/status',
  validate({
    params: z.object({ id: objectId, itemId: objectId }),
    body: z.object({
      status: z.enum(ORDER_STAGES).refine((s) => s !== 'placed', { message: 'The order is already placed — pick a later checkpoint.' }),
      note: z.string().trim().max(200).optional(),
    }).strict(),
  }),
  asyncHandler(async (req, res) => {
    const order = await updateItemStatus({
      orderId: req.params.id, itemId: req.params.itemId,
      status: req.body.status, note: req.body.note,
    });
    res.json({ order: await getAdminOrder(order._id) });
  }));

export default router;
