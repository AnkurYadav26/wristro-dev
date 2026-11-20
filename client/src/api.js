/**
 * Thin fetch wrapper for the WRISTORA API.
 * - Base path is /api, proxied to the Express server by Vite (see vite.config.js).
 * - credentials: 'include' so the httpOnly auth cookie is sent.
 * - Normalises the backend error shape { error: { code, message, details } } into ApiError.
 */
const BASE = '/api';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const parse = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export async function api(method, path, { body, headers, query } = {}) {
  let url = BASE + path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      qs.append(k, v);
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const opts = { method, credentials: 'include', headers: { ...(headers || {}) } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const data = parse(await res.text());
  if (!res.ok) {
    const e = data?.error || {};
    throw new ApiError(res.status, e.code, e.message || `Request failed (${res.status})`, e.details);
  }
  return data;
}

/** A fresh key per checkout attempt so retries/double-clicks don't create two stock holds. */
export const newIdempotencyKey = () => {
  const raw =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return raw.slice(0, 40);
};
