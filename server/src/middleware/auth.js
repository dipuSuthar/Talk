import { verifyAccess } from "../lib/tokens.js";
import { unauthorized } from "../lib/errors.js";

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthorized("Not authorized, no token");
  const payload = verifyAccess(header.slice(7));
  req.userId = payload.sub;
  next();
}
