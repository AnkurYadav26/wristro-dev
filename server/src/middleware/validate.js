import { AppError } from '../utils/AppError.js';

/** validate({ body: zodSchema, query: zodSchema, params: zodSchema }) -> replaces req.* with parsed values. */
export const validate = (schemas) => (req, _res, next) => {
  try {
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const r = schemas[part].safeParse(req[part] ?? {});
      if (!r.success) {
        const fields = r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
        return next(new AppError(422, 'VALIDATION_ERROR', 'Some fields are invalid.', fields));
      }
      if (part === 'query') { req.validatedQuery = r.data; } else { req[part] = r.data; }
    }
    next();
  } catch (e) { next(e); }
};
