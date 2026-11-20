import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import catalog from './catalog.js';
import inventory from './inventory.js';
import uploads from './uploads.js';
import orders from './orders.js';

const router = Router();
router.use(requireAdmin); // every /api/admin/* route needs a logged-in admin
router.use('/uploads', uploads);
router.use(catalog);
router.use(inventory);
router.use(orders);
export default router;
