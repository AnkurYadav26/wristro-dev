import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/AppError.js';
import { validate } from '../middleware/validate.js';
import { lookupLimiter } from '../middleware/security.js';
import { STATES, UNION_TERRITORIES } from '../utils/india.js';
import { lookupPincode } from '../services/pincodeService.js';

const router = Router();
router.get('/meta/states', (_req, res) => res.json({ states: STATES, unionTerritories: UNION_TERRITORIES, country: 'India' }));

/** City/district/state auto-fill. `unavailable: true` means "lookup service down, let the user type it". */
router.get('/pincode/:pin', lookupLimiter, validate({ params: z.object({ pin: z.string().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code') }) }),
  asyncHandler(async (req, res) => res.json(await lookupPincode(req.params.pin))));

export default router;
