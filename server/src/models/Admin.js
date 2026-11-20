import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * Administrator identities live in their OWN collection, completely separate from customer
 * accounts (User). Customers and admins therefore have independent login systems.
 */
const adminSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['super_admin', 'admin'], default: 'admin', index: true },
  // New admins start as "pending" and only become "active" once BOTH OTPs are verified.
  status: { type: String, enum: ['pending', 'active', 'blocked'], default: 'active' },
  emailVerified: { type: Boolean, default: false },
  tokenVersion: { type: Number, default: 0 }, // bump to invalidate every existing session
  lastLoginAt: Date,
  createdBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
}, { timestamps: true });

adminSchema.methods.toPublic = function () {
  return {
    id: this._id, name: this.name, email: this.email, role: this.role, status: this.status,
    emailVerified: this.emailVerified, isSuperAdmin: this.role === 'super_admin', lastLoginAt: this.lastLoginAt,
  };
};
export const Admin = mongoose.model('Admin', adminSchema);
