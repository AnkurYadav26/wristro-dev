import { Router } from 'express';
import { requireAdminAuth } from '../../middleware/adminAuth.js';
import catalog from './catalog.js';
import inventory from './inventory.js';
import uploads from './uploads.js';
import orders from './orders.js';

const router = Router();
router.use(requireAdminAuth); // every /api/admin/* route needs a signed-in administrator (admin session)
router.use('/uploads', uploads);
router.use(catalog);
router.use(inventory);
router.use(orders);
export default router;
