import env from '../config/env.js';
import { isValidPincode, parsePincodeResponse } from '../utils/india.js';

const cache = new Map(); // pin -> { at, ttl, value }
const HIT_TTL = 24 * 3600_000, MISS_TTL = 10 * 60_000, MAX = 5000;

/**
 * Best-effort PIN -> {state, district, city, areas}. Never throws.
 * Returns { found:true,... } | { found:false } (PIN unknown) | { found:false, unavailable:true } (lookup service down).
 * Checkout must keep working when the lookup service is unavailable.
 */
export async function lookupPincode(pin, fetchImpl = fetch) {
  if (!isValidPincode(pin)) return { found: false, invalid: true };
  const hit = cache.get(pin);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const res = await fetchImpl(`${env.PINCODE_API_URL}/${pin}`, { signal: ctl.signal, headers: { accept: 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) return { found: false, unavailable: true };
    const value = parsePincodeResponse(await res.json());
    if (cache.size >= MAX) cache.delete(cache.keys().next().value);
    cache.set(pin, { at: Date.now(), ttl: value.found ? HIT_TTL : MISS_TTL, value });
    return value;
  } catch {
    return { found: false, unavailable: true }; // not cached, so we retry next time
  }
}
