import mongoose from 'mongoose';
import env from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export const notFound = (req, _res, next) => next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  let e = err;
  if (err?.type === 'entity.parse.failed') e = new AppError(400, 'BAD_JSON', 'Malformed JSON body.');
  else if (err?.type === 'entity.too.large') e = new AppError(413, 'TOO_LARGE', 'Request body too large.');
  else if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern ?? {})[0] ?? 'field';
    e = new AppError(409, 'DUPLICATE', `A record with this ${field} already exists.`, { field });
  } else if (err instanceof mongoose.Error.CastError) e = new AppError(400, 'BAD_ID', `Invalid ${err.path}.`);
  else if (err instanceof mongoose.Error.ValidationError) {
    e = new AppError(422, 'VALIDATION_ERROR', 'Some fields are invalid.',
      Object.values(err.errors).map((x) => ({ field: x.path, message: x.message })));
  }

  if (!(e instanceof AppError)) {
    console.error('[unhandled]', err);
    e = new AppError(500, 'INTERNAL', 'Something went wrong.');
  }
  res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
}
