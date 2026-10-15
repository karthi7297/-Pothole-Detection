import { httpError } from './error.js';

/**
 * Tiny in-memory sliding-window rate limiter.
 * Good enough for a single-node deployment; swap for Redis in a cluster.
 */
export function rateLimit({ windowMs = 60_000, max = 120, key = (req) => req.ip } = {}) {
  const hits = new Map();

  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, times] of hits) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
  }, windowMs).unref?.();

  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    const cutoff = now - windowMs;
    const times = (hits.get(k) || []).filter((t) => t > cutoff);
    times.push(now);
    hits.set(k, times);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - times.length));

    if (times.length > max) {
      return next(
        httpError(429, `Too many requests — retry in ${Math.ceil(windowMs / 1000)}s.`, 'RATE_LIMITED')
      );
    }
    next();
  };
}
