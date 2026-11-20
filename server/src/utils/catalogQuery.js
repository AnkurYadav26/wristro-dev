/** Pure builders that turn query-string params into Mongo filters/sorts. */
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const list = (v) => (v == null ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean));

export const SORTS = Object.freeze({
  relevance: { score: { $meta: 'textScore' } },
  price_asc: { sellingPricePaise: 1, _id: 1 },
  price_desc: { sellingPricePaise: -1, _id: 1 },
  newest: { createdAt: -1, _id: 1 },
  bestsellers: { soldCount: -1, _id: 1 },
  popularity: { ratingCount: -1, soldCount: -1, _id: 1 },
  discount: { discountPercent: -1, _id: 1 },
  rating: { ratingAverage: -1, ratingCount: -1, _id: 1 },
});

/** @param {object} p validated query params; categoryIds already resolved from slugs */
export function buildProductFilter(p, { categoryIds } = {}) {
  const f = { isActive: true, isArchived: false };
  if (p.q) f.$text = { $search: p.q };
  if (categoryIds?.length) f.categoryId = { $in: categoryIds };
  const brands = list(p.brand);
  if (brands.length) f.brand = { $in: brands.map((b) => new RegExp(`^${escapeRegex(b)}$`, 'i')) };
  const types = list(p.watchType); if (types.length) f.watchType = { $in: types };
  const genders = list(p.gender); if (genders.length) f.gender = { $in: genders };
  const colours = list(p.colour);
  if (colours.length) f.colour = { $in: colours.map((c) => new RegExp(`^${escapeRegex(c)}$`, 'i')) };
  const features = list(p.features); if (features.length) f.features = { $all: features };
  if (p.minPrice != null || p.maxPrice != null) {
    f.sellingPricePaise = {};
    if (p.minPrice != null) f.sellingPricePaise.$gte = p.minPrice;
    if (p.maxPrice != null) f.sellingPricePaise.$lte = p.maxPrice;
  }
  if (p.minRating != null) f.ratingAverage = { $gte: p.minRating };
  if (p.inStock) f.$expr = { $gt: [{ $subtract: ['$stockOnHand', '$stockReserved'] }, 0] };
  return f;
}

export function buildSort(sort, hasText) {
  if (sort === 'relevance' && !hasText) return SORTS.newest;
  return SORTS[sort] ?? (hasText ? SORTS.relevance : SORTS.newest);
}
