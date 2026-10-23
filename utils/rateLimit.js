// Tiny in-memory rate limiter for public endpoints (one server process, so memory is enough).
export const rateLimit = ({ windowMs = 60000, max = 20, key = (req) => req.ip } = {}) => {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = `${key(req)}:${req.baseUrl}${req.route?.path || req.path}`;
    const now = Date.now();
    const entry = hits.get(k) || { count: 0, reset: now + windowMs };
    if (entry.reset < now) Object.assign(entry, { count: 0, reset: now + windowMs });
    entry.count++;
    hits.set(k, entry);
    if (entry.count > max) return res.status(429).json({ success: false, message: "Too many requests. Please try again in a minute." });
    next();
  };
};
