import mongoose from 'mongoose';
const { Schema } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  mobile: { type: String, unique: true, sparse: true, match: /^[6-9]\d{9}$/ }, // 10-digit Indian mobile, no +91
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['customer', 'admin'], default: 'customer', index: true },
  status: { type: String, enum: ['active', 'blocked'], default: 'active' },
  emailVerified: { type: Boolean, default: false },
  mobileVerified: { type: Boolean, default: false }, // set by the SMS flow once a provider is wired up
  tokenVersion: { type: Number, default: 0 }, // bump to invalidate every existing session
  lastLoginAt: Date,
}, { timestamps: true });

userSchema.methods.toPublic = function () {
  return { id: this._id, name: this.name, email: this.email, mobile: this.mobile, role: this.role,
    emailVerified: this.emailVerified, mobileVerified: this.mobileVerified };
};
export const User = mongoose.model('User', userSchema);
