import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "../models/User.js";
import { validate } from "../middleware/validate.js";
import { loginLimiter, registerLimiter } from "../middleware/limits.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError, unauthorized } from "../lib/errors.js";
import { signAccess, issueRefreshToken, rotateRefreshToken, revokeRefreshToken, REFRESH_COOKIE, refreshCookieOptions } from "../lib/tokens.js";

export const authRouter = Router();

const email = z.string().trim().toLowerCase().email("Enter a valid email").max(254);
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Password needs at least one letter and one number");

const registerBody = z.object({ name: z.string().trim().min(2, "Name is too short").max(60), email, password });
const loginBody = z.object({ email, password: z.string().min(1).max(72) });

const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12); // equalises timing for unknown emails

async function startSession(res, user, req) {
  const refresh = await issueRefreshToken(user._id, { userAgent: req.get("user-agent") });
  res.cookie(REFRESH_COOKIE, refresh, refreshCookieOptions());
  return { accessToken: signAccess(user._id), user: user.toPublic() };
}

authRouter.post("/register", registerLimiter, validate({ body: registerBody }), async (req, res) => {
  const { name, email, password } = req.valid.body;
  if (await User.exists({ email })) throw new AppError(409, "An account with this email already exists");
  const user = await User.create({ name, email, password: await bcrypt.hash(password, 12) });
  res.status(201).json(await startSession(res, user, req));
});

authRouter.post("/login", loginLimiter, validate({ body: loginBody }), async (req, res) => {
  const { email, password } = req.valid.body;
  const user = await User.findOne({ email }).select("+password");
  const ok = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized("Invalid email or password");
  res.json(await startSession(res, user, req));
});

// Silent session renewal: swaps the httpOnly refresh cookie for a new access token.
authRouter.post("/refresh", async (req, res) => {
  const { userId, refreshToken } = await rotateRefreshToken(req.cookies?.[REFRESH_COOKIE], req.get("user-agent"));
  const user = await User.findById(userId);
  if (!user) throw unauthorized("Account no longer exists");
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  res.json({ accessToken: signAccess(user._id), user: user.toPublic() });
});

authRouter.post("/logout", async (req, res) => {
  await revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) throw unauthorized();
  res.json({ user: user.toPublic() });
});
