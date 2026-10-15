import { NODE_ENV } from '../config.js';

/** 404 for unmatched API routes. */
export function notFound(req, res) {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `No route matches ${req.method} ${req.originalUrl}`,
  });
}

/** Central error handler — every thrown error becomes a consistent envelope. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const body = {
    error: err.code || (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
    message: err.expose === false && status === 500 ? 'Something went wrong.' : err.message,
  };
  if (err.details) body.details = err.details;
  if (status >= 500) console.error('[error]', err);
  if (NODE_ENV !== 'production' && status >= 500 && err.stack) body.stack = err.stack.split('\n').slice(0, 4);
  res.status(status).json(body);
}

/** Wrap async handlers so rejections reach errorHandler. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Small helper for throwing HTTP-aware errors from anywhere. */
export function httpError(status, message, code, details) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  if (details) err.details = details;
  return err;
}
