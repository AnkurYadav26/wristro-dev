import mongoose from 'mongoose';
const supplierSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  companyName: { type: String, trim: true },
  contactPerson: { type: String, trim: true },
  phone: { type: String, trim: true },
  email: { type: String, lowercase: true, trim: true },
  gstin: { type: String, uppercase: true, trim: true,
    match: [/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Invalid GSTIN format'] },
  address: { line1: String, line2: String, city: String, state: String, pincode: String },
  notes: String,
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
supplierSchema.index({ name: 1 });
export const Supplier = mongoose.model('Supplier', supplierSchema);
