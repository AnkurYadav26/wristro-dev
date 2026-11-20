import crypto from 'node:crypto';
export const slugify = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
export const shortId = () => crypto.randomBytes(3).toString('hex');
export const parsePaging = ({ page, limit }, maxLimit = 60) => {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(maxLimit, Math.max(1, Number(limit) || 20));
  return { page: p, limit: l, skip: (p - 1) * l };
};
