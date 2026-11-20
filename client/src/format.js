/** Money helpers. The API speaks integer paise everywhere (₹1 = 100 paise). */

export const inr = (paise) =>
  `₹${(((paise ?? 0) / 100)).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

/** Rupees (string/number from a form) -> integer paise. */
export const toPaise = (rupees) => {
  const n = Number(rupees);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** Paise -> plain rupee number for form inputs. */
export const toRupees = (paise) => (paise ?? 0) / 100;

export const discountPct = (mrpPaise, sellingPaise) => {
  if (!mrpPaise || sellingPaise == null) return 0;
  return Math.round(((mrpPaise - sellingPaise) / mrpPaise) * 100);
};

export const formatDate = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');

/** "18 November 2026" — the format the order tracking screens use. */
export const formatDay = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

/** "18 Nov 2026, 4:05 pm" — compact stamp for a completed tracking step. */
export const formatStamp = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

