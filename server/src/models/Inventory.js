import mongoose from 'mongoose';
const { Schema } = mongoose;

export const MOVEMENT_TYPES = {
  opening_stock: +1, purchase_in: +1, return_in: +1, adjustment_in: +1,
  sale: -1, damage_out: -1, adjustment_out: -1,
};

const movementSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  type: { type: String, enum: Object.keys(MOVEMENT_TYPES), required: true },
  quantity: { type: Number, required: true },        // signed change in on-hand units
  onHandAfter: { type: Number, required: true },
  reference: { kind: String, id: Schema.Types.ObjectId }, // purchase_order | reservation | order
  note: String,
  actorId: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: true, updatedAt: false } });
movementSchema.index({ productId: 1, createdAt: -1 });
movementSchema.index({ type: 1, createdAt: -1 });
export const InventoryMovement = mongoose.model('InventoryMovement', movementSchema);

const reservationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  idempotencyKey: { type: String, unique: true, sparse: true },
  status: { type: String, enum: ['active', 'committed', 'released', 'expired'], default: 'active', index: true },
  expiresAt: { type: Date, required: true },
  items: [{
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    held: { type: Boolean, default: false }, // true once stockReserved was incremented for this line
  }],
  orderRef: Schema.Types.ObjectId,
  settledAt: Date,
}, { timestamps: true });
reservationSchema.index({ status: 1, expiresAt: 1 });
export const StockReservation = mongoose.model('StockReservation', reservationSchema);

const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
export const Counter = mongoose.model('Counter', counterSchema);

const poSchema = new Schema({
  poNumber: { type: String, unique: true, required: true },
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
  items: [{
    _id: false,
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitCostPaise: { type: Number, required: true, min: 0 },
    receivedQuantity: { type: Number, default: 0, min: 0 },
  }],
  subtotalPaise: { type: Number, required: true },
  taxesPaise: { type: Number, default: 0, min: 0 },
  totalPaise: { type: Number, required: true },
  purchaseDate: { type: Date, default: Date.now },
  paymentStatus: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
  status: { type: String, enum: ['ordered', 'partial', 'received', 'cancelled'], default: 'ordered' },
  invoiceUrl: String,
  notes: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
poSchema.index({ supplierId: 1, purchaseDate: -1 });
export const PurchaseOrder = mongoose.model('PurchaseOrder', poSchema);
