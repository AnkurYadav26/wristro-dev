/** Shipping and GST-inclusive breakdown. PURE; integer paise only. */

/**
 * Shipping on the amount the customer pays for goods (after all discounts).
 * Free at or above the threshold; flat fee below. Zero-fee configs are allowed.
 */
export function shippingFor(goodsTotalPaise, { flatPaise, freeAbovePaise }) {
  if (goodsTotalPaise <= 0) return 0;
  if (freeAbovePaise != null && goodsTotalPaise >= freeAbovePaise) return 0;
  return flatPaise;
}

/** GST already contained in a GST-inclusive amount: amount × g / (100 + g), rounded per line. */
export const gstContained = (inclusivePaise, gstPercent) => Math.round((inclusivePaise * gstPercent) / (100 + gstPercent));

/**
 * @param {{totalPaise:number, lines:Array<{productId:string, finalTotalPaise:number}>}} quote  from priceCart
 * @param {Record<string, number>} gstByProductId
 * @returns {{goodsPaise, shippingPaise, payablePaise, gstIncludedPaise}}
 */
export function checkoutTotals(quote, gstByProductId, shippingCfg) {
  const goodsPaise = quote.totalPaise;
  const shippingPaise = shippingFor(goodsPaise, shippingCfg);
  const gstIncludedPaise = quote.lines.reduce((s, l) => s + gstContained(l.finalTotalPaise, gstByProductId[l.productId] ?? 0), 0);
  return { goodsPaise, shippingPaise, payablePaise: goodsPaise + shippingPaise, gstIncludedPaise };
}
