/** Indian states/UTs and PIN code helpers. PURE (no I/O). */

export const STATES = Object.freeze([
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
]);
export const UNION_TERRITORIES = Object.freeze([
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]);
export const ALL_STATES = Object.freeze([...STATES, ...UNION_TERRITORIES]);

const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]+/g, ' ').trim();
const ALIASES = new Map([
  ['orissa', 'Odisha'], ['uttaranchal', 'Uttarakhand'], ['pondicherry', 'Puducherry'],
  ['nct of delhi', 'Delhi'], ['new delhi', 'Delhi'], ['delhi ncr', 'Delhi'],
  ['dadra and nagar haveli', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['daman and diu', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['andaman and nicobar', 'Andaman and Nicobar Islands'], ['jammu and kashmir ut', 'Jammu and Kashmir'],
]);
const CANON = new Map(ALL_STATES.map((s) => [norm(s), s]));

/** Map any common spelling ("Orissa", "Jammu & Kashmir") to our canonical state name, or null. */
export const canonicalState = (input) => CANON.get(norm(input)) ?? ALIASES.get(norm(input)) ?? null;

/** 6 digits, first digit 1-9. Format check only: it does not prove the PIN exists. */
export const isValidPincode = (p) => /^[1-9]\d{5}$/.test(String(p ?? ''));

/**
 * Parse an India Post (api.postalpincode.in) response into a compact lookup result.
 * Shape: [{ Status: 'Success'|'Error'|'404', PostOffice: [{ Name, District, State, Block, ... }] }]
 */
export function parsePincodeResponse(json) {
  const r = Array.isArray(json) ? json[0] : null;
  const offices = r?.Status === 'Success' && Array.isArray(r.PostOffice) ? r.PostOffice : [];
  if (!offices.length) return { found: false };
  const first = offices[0];
  const state = canonicalState(first.State) ?? first.State ?? null;
  const district = first.District ?? null;
  return {
    found: true,
    state, district,
    city: first.Block && first.Block !== 'NA' ? first.Block : district,
    areas: [...new Set(offices.map((o) => o.Name).filter(Boolean))].slice(0, 30),
  };
}

/** Indian mobile: 10 digits starting 6-9. Accepts a leading +91/91/0 and spaces/dashes; returns the bare 10 digits or null. */
export function normalizeMobile(input) {
  let d = String(input ?? '').replace(/[\s-]/g, '');
  d = d.replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}
