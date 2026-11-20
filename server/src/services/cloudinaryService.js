/**
 * Cloudinary product-image uploads (admin only).
 *
 * The admin dashboard sends images as base64 data URLs; this service forwards each one to
 * Cloudinary's signed upload API and returns the permanent `secure_url`, which is what the
 * storefront renders. Signing happens server-side, so the API secret never reaches the browser.
 *
 * Gone through `fetch` + FormData (both global in Node 20), so no SDK dependency is needed.
 */
import crypto from 'node:crypto';
import env from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per image, before base64 encoding

export const cloudinaryConfigured = () =>
  Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

/** Validate and decode a `data:image/<type>;base64,<data>` URL. */
export function parseDataUrl(dataUrl) {
  const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl ?? ''));
  if (!match) throw new AppError(422, 'BAD_IMAGE', 'Expected an image sent as a base64 data URL.');
  const mime = match[1].toLowerCase();
  if (!ALLOWED_TYPES.has(mime)) throw new AppError(422, 'UNSUPPORTED_IMAGE', `Unsupported image type: ${mime}. Use JPEG, PNG, WebP, AVIF or GIF.`);
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new AppError(422, 'EMPTY_IMAGE', 'That image file is empty.');
  if (buffer.length > MAX_BYTES) throw new AppError(413, 'IMAGE_TOO_LARGE', `Each image must be ${MAX_BYTES / 1024 / 1024} MB or smaller.`);
  return { mime, buffer, ext: mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] };
}

/** Upload one image and return the details the admin form stores on the product. */
export async function uploadImage(dataUrl) {
  if (!cloudinaryConfigured()) {
    throw new AppError(503, 'CLOUDINARY_UNCONFIGURED',
      'Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to the server .env.');
  }
  const { mime, buffer, ext } = parseDataUrl(dataUrl);

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = env.CLOUDINARY_FOLDER;
  // Cloudinary signs the alphabetically-sorted params (minus file/api_key) + the API secret.
  const toSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1').update(`${toSign}${env.CLOUDINARY_API_SECRET}`).digest('hex');

  // Uploads occasionally fail with a transient socket error (EPIPE / ECONNRESET) before the
  // response arrives, so retry a couple of times with a freshly built body. Cloudinary-level
  // errors (403 permission, 400 bad request, …) come back as a response and are never retried.
  const RETRYABLE = new Set(['EPIPE', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);
  let res;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime }), `watch.${ext}`);
    form.append('api_key', env.CLOUDINARY_API_KEY);
    form.append('timestamp', String(timestamp));
    form.append('folder', folder);
    form.append('signature', signature);
    try {
      res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: form });
      break;
    } catch (err) {
      lastErr = err;
      const code = err?.cause?.code || err?.code || '';
      if (attempt < 3 && RETRYABLE.has(code)) {
        await new Promise((r) => setTimeout(r, attempt * 600));
        continue;
      }
      break;
    }
  }
  if (!res) {
    const detail = lastErr?.cause?.code || lastErr?.cause?.message || lastErr?.code || lastErr?.message || '';
    throw new AppError(502, 'UPLOAD_FAILED',
      `Could not reach Cloudinary${detail ? ` (${detail})` : ''}. Check the server’s network connection and try again.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.secure_url) {
    const reason = data?.error?.message || '';
    // Cloudinary returns 403 "missing permissions (actions=[\"create\"])" when the API key is
    // restricted and not allowed to upload. Surface an actionable hint instead of the raw text.
    if (res.status === 403 && /missing permissions|not allowed/i.test(reason)) {
      throw new AppError(502, 'CLOUDINARY_FORBIDDEN',
        'Cloudinary refused the upload: the API key in CLOUDINARY_API_KEY is not allowed to create images. '
        + 'In the Cloudinary console open Settings → API Keys, edit that key and enable the upload/create permission '
        + '(or paste a key that has it), then restart the server.');
    }
    throw new AppError(502, 'UPLOAD_FAILED', reason || 'Cloudinary rejected the upload.');
  }
  return { url: data.secure_url, publicId: data.public_id, width: data.width, height: data.height, bytes: data.bytes, format: data.format };
}
