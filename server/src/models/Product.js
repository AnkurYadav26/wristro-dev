import mongoose from 'mongoose';
import { standardUnitPrice } from '../services/pricing.js';
const { Schema } = mongoose;
const int = (extra = {}) => ({ type: Number, validate: { validator: Number.isInteger, message: '{PATH} must be an integer' }, ...extra });

/**
 * One document = one sellable SKU. A colour variant is its own Product; siblings share `variantGroup`.
 * Money is integer paise. Stock fields are changed ONLY by services/inventory.js (atomic ops).
 */
const productSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  slug: { type: String, required: true, unique: true, lowercase: true },
  sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
  brand: { type: String, required: true, trim: true, index: true },
  categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
  watchType: { type: String, enum: ['smart', 'digital', 'analog', 'hybrid'], required: true },
  gender: { type: String, enum: ['men', 'women', 'unisex'], default: 'unisex' },
  variantGroup: { type: String, index: true },
  colour: { type: String, trim: true },
  description: { type: String, default: '' },
  images: [{ _id: false, url: { type: String, required: true }, alt: String }],
  features: [String],
  specifications: [{ _id: false, key: String, value: String }],

  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier' },
  purchaseCostPaise: int({ default: 0, min: 0 }), // weighted-average cost of units on hand
  mrpPaise: int({ required: true, min: 1 }),      // verified reference price (MRP)
  mrpSource: { name: String, url: String, verifiedAt: Date, note: String },
  discountPercent: { type: Number, min: 0, max: 90, default: 40 },
  sellingPricePaise: int({ min: 0 }),             // DERIVED from mrp+discount (pre-validate hook)
  gstPercent: { type: Number, min: 0, max: 40, default: 18 },
  minMarginPercent: { type: Number, min: 0, max: 500, default: 10 },
  allowBelowCostCoupon: { type: Boolean, default: false },

  stockOnHand: int({ default: 0, min: 0 }),
  stockReserved: int({ default: 0, min: 0 }),
  lowStockThreshold: int({ default: 5, min: 0 }),

  weightGrams: Number,
  dimensionsMm: { length: Number, width: Number, height: Number },
  warrantyMonths: { type: Number, min: 0, default: 0 },
  warrantyNote: String,
  returnEligible: { type: Boolean, default: true },
  returnWindowDays: { type: Number, min: 0, default: 7 },

  isActive: { type: Boolean, default: true },
  isArchived: { type: Boolean, default: false },
  isDemo: { type: Boolean, default: false },
  soldCount: { type: Number, default: 0 },
  ratingAverage: { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 },
}, { timestamps: true });

productSchema.pre('validate', function (next) {
  if (Number.isInteger(this.mrpPaise) && this.discountPercent != null) {
    this.sellingPricePaise = standardUnitPrice({ mrpPaise: this.mrpPaise, discountPercent: this.discountPercent });
  }
  next();
});
productSchema.index({ name: 'text', brand: 'text', description: 'text' }, { weights: { name: 10, brand: 6, description: 1 } });
productSchema.index({ isActive: 1, isArchived: 1, sellingPricePaise: 1 });
productSchema.index({ soldCount: -1 });

productSchema.virtual('stockAvailable').get(function () { return this.stockOnHand - this.stockReserved; });

/** What the public storefront may see: no cost, supplier, margin or exact stock. */
productSchema.methods.toPublic = function (maxPurchasable = 10) {
  const available = this.stockOnHand - this.stockReserved;
  return {
    id: this._id, name: this.name, slug: this.slug, sku: this.sku, brand: this.brand,
    categoryId: this.categoryId, watchType: this.watchType, gender: this.gender,
    variantGroup: this.variantGroup, colour: this.colour,
    description: this.description, images: this.images, features: this.features, specifications: this.specifications,
    mrpPaise: this.mrpPaise, discountPercent: this.discountPercent, sellingPricePaise: this.sellingPricePaise,
    promoPricePaise: null, promoCode: null, // filled in by the catalogue route when the promo coupon is live and applies
    stockStatus: available <= 0 ? 'out_of_stock' : available <= this.lowStockThreshold ? 'low_stock' : 'in_stock',
    maxPurchasable: Math.max(0, Math.min(available, maxPurchasable)),
    weightGrams: this.weightGrams, dimensionsMm: this.dimensionsMm,
    warrantyMonths: this.warrantyMonths, warrantyNote: this.warrantyNote,
    returnEligible: this.returnEligible, returnWindowDays: this.returnWindowDays,
    ratingAverage: this.ratingAverage, ratingCount: this.ratingCount,
  };
};
export const Product = mongoose.model('Product', productSchema);
