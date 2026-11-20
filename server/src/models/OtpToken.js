import mongoose from 'mongoose';
const { Schema } = mongoose;

const otpSchema = new Schema({
  identifier: { type: String, required: true },
  purpose: { type: String, enum: ['verify_email', 'reset_password', 'admin_login'], required: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  consumed: { type: Boolean, default: false },
  lastSentAt: { type: Date, required: true },
  windowStart: { type: Date, required: true },
  sendCount: { type: Number, default: 1 },
}, { timestamps: true });

otpSchema.index({ identifier: 1, purpose: 1 }, { unique: true });
otpSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 24 * 3600 }); // housekeeping
export const OtpToken = mongoose.model('OtpToken', otpSchema);
