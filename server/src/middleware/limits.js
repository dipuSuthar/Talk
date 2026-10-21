import rateLimit from "express-rate-limit";

const base = { standardHeaders: "draft-7", legacyHeaders: false, message: { message: "Too many requests, slow down." } };

export const globalLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 300 });

// Brute-force protection: keyed by IP + email so one attacker can't lock out everyone.
export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email ?? "").toLowerCase()}`,
  validate: { keyGeneratorIpFallback: false },
  message: { message: "Too many login attempts. Try again in 15 minutes." },
});
export const registerLimiter = rateLimit({ ...base, windowMs: 60 * 60_000, limit: 20, message: { message: "Too many sign-ups from this network. Try later." } });

const byUser = (req) => req.userId ?? req.ip;
export const messageLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 90, keyGenerator: byUser, validate: { keyGeneratorIpFallback: false } });
export const uploadLimiter = rateLimit({ ...base, windowMs: 10 * 60_000, limit: 30, keyGenerator: byUser, validate: { keyGeneratorIpFallback: false }, message: { message: "Upload limit reached. Try again in a few minutes." } });
export const mediaGrantLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 120, keyGenerator: byUser, validate: { keyGeneratorIpFallback: false } });
