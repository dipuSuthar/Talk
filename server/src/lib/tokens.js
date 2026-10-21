import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { RefreshToken } from "../models/RefreshToken.js";
import { sha256 } from "./util.js";
import { unauthorized } from "./errors.js";

const ALG = { algorithms: ["HS256"] };

export const signAccess = (userId) =>
  jwt.sign({ sub: userId.toString() }, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    expiresIn: env.ACCESS_TOKEN_TTL,
    audience: "access",
  });

export function verifyAccess(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { ...ALG, audience: "access" });
  } catch {
    throw unauthorized("Session expired");
  }
}

// Short-lived, user-bound, message-bound grant used in media URLs.
export const signMedia = (userId, messageId, ttlSeconds) =>
  jwt.sign({ sub: userId.toString(), mid: messageId.toString() }, env.JWT_MEDIA_SECRET, {
    algorithm: "HS256",
    expiresIn: ttlSeconds,
    audience: "media",
  });

export function verifyMedia(token) {
  try {
    return jwt.verify(token, env.JWT_MEDIA_SECRET, { ...ALG, audience: "media" });
  } catch {
    throw unauthorized("Media link expired");
  }
}

// ---- refresh tokens (opaque, hashed at rest, rotated on every use) ----------

const refreshExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 864e5);

export async function issueRefreshToken(userId, { family, userAgent } = {}) {
  const raw = crypto.randomBytes(48).toString("base64url");
  await RefreshToken.create({
    user: userId,
    tokenHash: sha256(raw),
    family: family ?? crypto.randomUUID(),
    userAgent: userAgent?.slice(0, 200),
    expiresAt: refreshExpiry(),
  });
  return raw;
}

/** Exchanges a refresh token for a new one. Replaying an old token kills the whole family. */
export async function rotateRefreshToken(raw, userAgent) {
  if (!raw) throw unauthorized("No session");
  const doc = await RefreshToken.findOneAndUpdate(
    { tokenHash: sha256(raw), used: false, expiresAt: { $gt: new Date() } },
    { $set: { used: true } },
  );
  if (!doc) {
    // Either unknown/expired, or an already-used token was replayed (theft signal).
    const replayed = await RefreshToken.findOne({ tokenHash: sha256(raw) });
    if (replayed) await RefreshToken.deleteMany({ family: replayed.family });
    throw unauthorized("Session expired, please sign in again");
  }
  const next = await issueRefreshToken(doc.user, { family: doc.family, userAgent });
  return { userId: doc.user, refreshToken: next };
}

export const revokeRefreshToken = async (raw) => {
  if (!raw) return;
  const doc = await RefreshToken.findOne({ tokenHash: sha256(raw) });
  if (doc) await RefreshToken.deleteMany({ family: doc.family });
};

export const REFRESH_COOKIE = "talk_rt";
export const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: "lax",
  path: "/api/auth",
  maxAge: env.REFRESH_TOKEN_DAYS * 864e5,
});
