import mongoose from 'mongoose';
import { ALL_STATES } from '../utils/india.js';
const { Schema } = mongoose;

const addressSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fullName: { type: String, required: true, trim: true, maxlength: 80 },
  mobile: { type: String, required: true, match: /^[6-9]\d{9}$/ },
  alternateMobile: { type: String, match: /^[6-9]\d{9}$/ },
  pincode: { type: String, required: true, match: /^[1-9]\d{5}$/ },
  houseNo: { type: String, required: true, trim: true, maxlength: 60 },
  buildingName: { type: String, trim: true, maxlength: 100 },
  street: { type: String, required: true, trim: true, maxlength: 160 },
  landmark: { type: String, trim: true, maxlength: 100 },
  city: { type: String, required: true, trim: true, maxlength: 80 },
  district: { type: String, required: true, trim: true, maxlength: 80 },
  state: { type: String, required: true, enum: ALL_STATES },
  country: { type: String, default: 'India', enum: ['India'], immutable: true }, // India-only delivery
  isDefault: { type: Boolean, default: false },
  pinVerified: { type: Boolean, default: false }, // PIN lookup succeeded AND state matched
}, { timestamps: true });

// At most one default address per user, enforced by the database.
addressSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { isDefault: true }, name: 'one_default_per_user' });

export const ADDRESS_FIELDS = ['fullName', 'mobile', 'alternateMobile', 'pincode', 'houseNo', 'buildingName', 'street', 'landmark', 'city', 'district', 'state', 'country'];
export const Address = mongoose.model('Address', addressSchema);
