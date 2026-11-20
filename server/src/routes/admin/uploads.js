import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/AppError.js';
import { validate } from '../../middleware/validate.js';
import { uploadImage, cloudinaryConfigured } from '../../services/cloudinaryService.js';

const router = Router();

/** Lets the admin UI show/hide the upload control without guessing. */
router.get('/status', (_req, res) => res.json({ configured: cloudinaryConfigured() }));

const uploadBody = z.object({ dataUrl: z.string().min(32) }).strict();

/** Upload one image (base64 data URL) to Cloudinary and return its permanent URL. */
router.post('/', validate({ body: uploadBody }), asyncHandler(async (req, res) =>
  res.status(201).json({ image: await uploadImage(req.body.dataUrl) })));

export default router;
