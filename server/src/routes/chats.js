import { Router } from "express";
import fsp from "node:fs/promises";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { messageLimiter, uploadLimiter } from "../middleware/limits.js";
import { uploadMedia } from "../middleware/upload.js";
import { oid } from "../lib/util.js";
import { badRequest } from "../lib/errors.js";
import { processUpload } from "../lib/media.js";
import * as storage from "../lib/storage.js";
import * as chats from "../services/chats.js";
import * as messages from "../services/messages.js";
import { serializeMessage } from "../lib/serialize.js";
import { logger } from "../lib/logger.js";

export const chatsRouter = Router();
chatsRouter.use(requireAuth);

const objectId = z.string().length(24, "Invalid id");
const groupName = z.string().trim().min(1, "Group name is required").max(60);

chatsRouter.get("/", async (req, res) => res.json(await chats.listChats(req.userId)));
chatsRouter.get("/:chatId", async (req, res) => res.json(await chats.getChat(oid(req.params.chatId), req.userId)));

chatsRouter.post("/direct", validate({ body: z.object({ userId: objectId }) }), async (req, res) => {
  res.json(await chats.openDirectChat(req.userId, oid(req.valid.body.userId)));
});

chatsRouter.post(
  "/group",
  validate({ body: z.object({ name: groupName, userIds: z.array(objectId).min(2).max(chats.MAX_GROUP_SIZE) }) }),
  async (req, res) => res.status(201).json(await chats.createGroup(req.userId, req.valid.body)),
);

chatsRouter.patch("/:chatId", validate({ body: z.object({ name: groupName }) }), async (req, res) =>
  res.json(await chats.renameGroup(oid(req.params.chatId), req.userId, req.valid.body.name)),
);

chatsRouter.post("/:chatId/members", validate({ body: z.object({ userIds: z.array(objectId).min(1).max(50) }) }), async (req, res) =>
  res.json(await chats.addMembers(oid(req.params.chatId), req.userId, req.valid.body.userIds)),
);
chatsRouter.delete("/:chatId/members/:userId", async (req, res) =>
  res.json(await chats.removeMember(oid(req.params.chatId), req.userId, oid(req.params.userId))),
);

chatsRouter.post("/:chatId/read", async (req, res) => res.json(await messages.markRead(oid(req.params.chatId), req.userId)));

// ---- messages ---------------------------------------------------------------

chatsRouter.get(
  "/:chatId/messages",
  validate({
    query: z.object({
      before: objectId.optional(),
      limit: z.coerce.number().int().min(1).max(50).default(30),
    }),
  }),
  async (req, res) => {
    const { before, limit } = req.valid.query;
    res.json(await messages.listMessages(oid(req.params.chatId), req.userId, { before: before && oid(before), limit }));
  },
);

const sendBody = z.object({
  text: z.string().max(4000).optional().default(""),
  clientId: z.string().regex(/^[\w-]{6,64}$/).optional(),
  kind: z.enum(["text", "sticker", "image", "gif", "video"]).optional(),
  viewPolicy: z.enum(["unlimited", "once", "twice"]).optional().default("unlimited"),
  stickerPack: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
  stickerId: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
});

// JSON body for text/stickers, multipart/form-data (field "file") for photos, GIFs and videos.
chatsRouter.post("/:chatId/messages", messageLimiter, (req, res, next) => {
  // Only run the heavier upload limiter + multer when a file is actually being sent.
  if (req.is("multipart/form-data")) return uploadLimiter(req, res, (e) => (e ? next(e) : uploadMedia(req, res, next)));
  next();
}, async (req, res) => {
  const chatId = oid(req.params.chatId);
  const parsed = sendBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    if (req.file) await fsp.rm(req.file.path, { force: true });
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid message");
  }
  const body = parsed.data;
  let storedKey = null;
  try {
    let input;
    if (req.file) {
      const { kind, media } = await processUpload(req.file.path, body.kind);
      storedKey = media.key;
      const viewPolicy = kind === "sticker" ? "unlimited" : body.viewPolicy;
      input = { kind, text: body.text.trim().slice(0, 1000), media: { ...media, viewPolicy } };
    } else if (body.stickerPack && body.stickerId) {
      input = { kind: "sticker", sticker: { pack: body.stickerPack, id: body.stickerId } };
    } else {
      const text = body.text.trim();
      if (!text) throw badRequest("Message can't be empty");
      input = { kind: "text", text };
    }
    const { message, duplicate } = await messages.createMessage({ chatId, senderId: req.userId, clientId: body.clientId, ...input });
    if (duplicate && storedKey) await storage.removeKey(storedKey); // retry of an already-saved message
    res.status(duplicate ? 200 : 201).json({ message: serializeMessage(message, req.userId) });
  } catch (err) {
    if (storedKey) await storage.removeKey(storedKey).catch((e) => logger.warn({ err: e }, "cleanup failed"));
    throw err;
  } finally {
    if (req.file) await fsp.rm(req.file.path, { force: true });
  }
});
