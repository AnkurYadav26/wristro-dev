import { Router } from 'express';
import { z } from 'zod';
import { Address } from '../models/Address.js';
import env from '../config/env.js';
import { AppError, asyncHandler } from '../utils/AppError.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { objectId, addressBody, addressUpdate } from '../schemas.js';
import { lookupPincode } from '../services/pincodeService.js';

const router = Router();
router.use(requireAuth);
const idParam = validate({ params: z.object({ id: objectId }) });

/** Best-effort PIN/state cross-check. Never blocks saving: a failed or stale lookup must not stop a sale. */
async function checkPin(pincode, state) {
  const r = await lookupPincode(pincode);
  if (r.found && r.state === state) return { pinVerified: true, warnings: [] };
  if (r.found) return { pinVerified: false, warnings: [`PIN code ${pincode} is usually in ${r.state}, but you selected ${state}. Please double-check so your parcel is not delayed.`] };
  if (r.invalid || (!r.unavailable)) return { pinVerified: false, warnings: ['We could not find this PIN code. Please double-check it.'] };
  return { pinVerified: false, warnings: [] }; // lookup service unavailable: say nothing
}

async function makeDefault(userId, id) {
  await Address.updateMany({ userId, _id: { $ne: id }, isDefault: true }, { $set: { isDefault: false } });
  await Address.updateOne({ _id: id, userId }, { $set: { isDefault: true } });
}
const mustOwn = async (userId, id) => {
  const a = await Address.findOne({ _id: id, userId });
  if (!a) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found.');
  return a;
};

router.get('/', asyncHandler(async (req, res) =>
  res.json({ addresses: await Address.find({ userId: req.user._id }).sort({ isDefault: -1, updatedAt: -1 }).lean() })));

router.post('/', validate({ body: addressBody }), asyncHandler(async (req, res) => {
  const userId = req.user._id;
  if ((await Address.countDocuments({ userId })) >= env.MAX_ADDRESSES) {
    throw new AppError(409, 'ADDRESS_LIMIT', `You can save up to ${env.MAX_ADDRESSES} addresses. Delete one to add another.`);
  }
  const { isDefault, ...fields } = req.body;
  const first = !(await Address.exists({ userId }));
  const pin = await checkPin(fields.pincode, fields.state);
  const address = await Address.create({ ...fields, userId, pinVerified: pin.pinVerified, isDefault: false });
  if (first || isDefault) await makeDefault(userId, address._id);
  res.status(201).json({ address: await Address.findById(address._id).lean(), warnings: pin.warnings });
}));

router.patch('/:id', idParam, validate({ body: addressUpdate }), asyncHandler(async (req, res) => {
  const a = await mustOwn(req.user._id, req.params.id);
  const { isDefault, ...fields } = req.body;
  a.set(fields);
  let warnings = [];
  if (fields.pincode || fields.state) { const pin = await checkPin(a.pincode, a.state); a.pinVerified = pin.pinVerified; warnings = pin.warnings; }
  await a.save();
  if (isDefault) await makeDefault(req.user._id, a._id);
  res.json({ address: await Address.findById(a._id).lean(), warnings });
}));

router.post('/:id/default', idParam, asyncHandler(async (req, res) => {
  await mustOwn(req.user._id, req.params.id);
  await makeDefault(req.user._id, req.params.id);
  res.json({ addresses: await Address.find({ userId: req.user._id }).sort({ isDefault: -1, updatedAt: -1 }).lean() });
}));

router.delete('/:id', idParam, asyncHandler(async (req, res) => {
  const a = await mustOwn(req.user._id, req.params.id);
  await a.deleteOne();
  if (a.isDefault) {
    const next = await Address.findOne({ userId: req.user._id }).sort({ updatedAt: -1 });
    if (next) await makeDefault(req.user._id, next._id);
  }
  res.json({ deleted: true });
}));

export default router;
