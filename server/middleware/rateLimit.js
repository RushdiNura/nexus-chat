const windows = new Map();

export function authRateLimit({ windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of windows) if (record.resetAt <= now) windows.delete(key);
  }, Math.min(windowMs, 60_000));
  cleanup.unref?.();

  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let record = windows.get(key);
    if (!record || record.resetAt <= now) {
      record = { count: 0, resetAt: now + windowMs };
      windows.set(key, record);
    }
    record.count += 1;
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - record.count)));
    if (record.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((record.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, message: "Too many authentication attempts. Please try again later." });
    }
    return next();
  };
}
