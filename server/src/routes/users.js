import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { uploadAvatar } from "../middleware/upload.js";
import { uploadLimiter } from "../middleware/limits.js";
import { badRequest, notFound } from "../lib/errors.js";
import { escapeRegex, oid, idStr } from "../lib/util.js";
import { processAvatar } from "../lib/media.js";
import * as storage from "../lib/storage.js";
import { presence } from "../services/realtime.js";
import { userBrief } from "../lib/serialize.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);

const maskEmail = (e) => e.replace(/^(.).*(@.*)$/, "$1***$2");

// Find people: exact email, or name-word prefix. (No prefix search on emails => can't be harvested.)
usersRouter.get("/search", validate({ query: z.object({ q: z.string().trim().min(2).max(60) }) }), async (req, res) => {
  const q = req.valid.query.q.toLowerCase();
  const filter = q.includes("@") ? { email: q } : { nameTokens: { $regex: `^${escapeRegex(q)}` } };
  const users = await User.find({ ...filter, _id: { $ne: req.userId } }).limit(20);
  res.json(users.map((u) => ({ ...userBrief(u), email: maskEmail(u.email), online: presence.isOnline(u._id) })));
});

usersRouter.patch(
  "/me",
  validate({ body: z.object({ name: z.string().trim().min(2).max(60).optional(), about: z.string().trim().max(160).optional() }) }),
  async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) throw notFound();
    Object.assign(user, req.valid.body);
    await user.save();
    res.json({ user: user.toPublic() });
  },
);

usersRouter.put("/me/avatar", uploadLimiter, uploadAvatar, async (req, res) => {
  if (!req.file) throw badRequest("Choose an image");
  const buffer = await processAvatar(req.file.path);
  const user = await User.findById(req.userId);
  const rel = `avatars/${crypto.randomUUID()}.webp`;
  await storage.putPublic(rel, buffer);
  const old = user.avatar?.startsWith("/uploads/avatars/") ? user.avatar.replace("/uploads/", "") : null;
  user.avatar = `/uploads/${rel}`;
  await user.save();
  if (old) await storage.removePublic(old);
  res.json({ user: user.toPublic() });
});

usersRouter.get("/me/blocked", async (req, res) => {
  const me = await User.findById(req.userId).select("+blocked");
  const users = await User.find({ _id: { $in: me.blocked } });
  res.json(users.map(userBrief));
});

usersRouter.post("/:id/block", async (req, res) => {
  const id = oid(req.params.id);
  if (idStr(id) === req.userId) throw badRequest("You can't block yourself");
  if (!(await User.exists({ _id: id }))) throw notFound("User not found");
  await User.updateOne({ _id: req.userId }, { $addToSet: { blocked: id } });
  res.json({ ok: true });
});
usersRouter.delete("/:id/block", async (req, res) => {
  await User.updateOne({ _id: req.userId }, { $pull: { blocked: oid(req.params.id) } });
  res.json({ ok: true });
});
