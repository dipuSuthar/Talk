import { Chat } from "../models/Chat.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";
import { notFound, forbidden, AppError } from "../lib/errors.js";
import { idStr } from "../lib/util.js";
import { previewFor, serializeMessage, serializeChat, viewCount, VIEW_LIMITS, GRANT_TTL, OPEN_TTL } from "../lib/serialize.js";
import { signMedia } from "../lib/tokens.js";
import * as storage from "../lib/storage.js";
import { emitPerMember, emitToUser } from "./realtime.js";
import { logger } from "../lib/logger.js";

export async function getChatForMember(chatId, userId, { populate = false } = {}) {
  let q = Chat.findOne({ _id: chatId, "members.user": userId });
  if (populate) q = q.populate("members.user", "name avatar about lastSeen");
  const chat = await q;
  if (!chat) throw notFound("Chat not found"); // same answer for "doesn't exist" and "not yours"
  return chat;
}

const memberIds = (chat) => chat.members.map((m) => idStr(m.user));

async function assertCanSend(chat, senderId) {
  if (chat.type !== "direct") return;
  const otherId = memberIds(chat).find((id) => id !== senderId.toString());
  if (!otherId) return;
  const [me, other] = await Promise.all([
    User.findById(senderId).select("+blocked").lean(),
    User.findById(otherId).select("+blocked").lean(),
  ]);
  const blockedByMe = me?.blocked?.some((b) => idStr(b) === otherId);
  const blockedByThem = other?.blocked?.some((b) => idStr(b) === senderId.toString());
  if (blockedByMe) throw forbidden("You blocked this user. Unblock them to send messages.");
  if (blockedByThem) throw forbidden("You can't message this user.");
}

export async function createMessage({ chatId, senderId, kind = "text", text = "", sticker, media, clientId }) {
  const chat = await getChatForMember(chatId, senderId);
  await assertCanSend(chat, senderId);

  if (clientId) {
    // Idempotency: a retried request returns the original message instead of duplicating it.
    const existing = await Message.findOne({ sender: senderId, clientId }).populate("sender", "name avatar");
    if (existing) return { message: existing, chat, duplicate: true };
  }

  let message;
  try {
    message = await Message.create({ chat: chat._id, sender: senderId, kind, text, sticker, media, clientId });
  } catch (err) {
    if (err?.code === 11000 && clientId) {
      const existing = await Message.findOne({ sender: senderId, clientId }).populate("sender", "name avatar");
      return { message: existing, chat, duplicate: true };
    }
    throw err;
  }

  const inc = {};
  for (const id of memberIds(chat)) if (id !== senderId.toString()) inc[`unread.${id}`] = 1;
  await Chat.updateOne(
    { _id: chat._id },
    {
      $set: {
        lastMessage: { _id: message._id, sender: senderId, kind, preview: previewFor(message), createdAt: message.createdAt },
      },
      $inc: inc,
    },
  );

  await message.populate("sender", "name avatar");
  const fresh = await Chat.findById(chat._id).select("lastMessage unread updatedAt members");
  broadcastNewMessage(fresh, message);
  return { message, chat: fresh, duplicate: false };
}

function broadcastNewMessage(chat, message) {
  const ids = memberIds(chat);
  emitPerMember(ids, "message:new", (viewerId) => ({
    message: serializeMessage(message, viewerId),
    chat: {
      _id: idStr(chat),
      lastMessage: serializeChat({ ...chat.toObject(), members: [] }, viewerId).lastMessage,
      unread: chat.unread.get(viewerId) ?? 0,
      updatedAt: chat.updatedAt,
    },
  }));
}

export async function listMessages(chatId, userId, { before, limit = 30 }) {
  await getChatForMember(chatId, userId);
  const filter = { chat: chatId };
  if (before) filter._id = { $lt: before };
  const rows = await Message.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("sender", "name avatar")
    .lean();
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  return { messages: page.map((m) => serializeMessage(m, userId)), hasMore };
}

export async function markRead(chatId, userId) {
  const chat = await getChatForMember(chatId, userId);
  const unread = chat.unread.get(userId.toString()) ?? 0;
  const ids = await Message.find({ chat: chatId, sender: { $ne: userId }, readBy: { $ne: userId } })
    .sort({ _id: -1 })
    .limit(Math.max(unread, 1) + 100)
    .distinct("_id");
  if (ids.length) await Message.updateMany({ _id: { $in: ids } }, { $addToSet: { readBy: userId } });
  await Chat.updateOne({ _id: chatId }, { $set: { [`unread.${userId}`]: 0 } });
  const payload = { chatId: idStr(chat), userId: userId.toString(), at: new Date().toISOString() };
  for (const id of memberIds(chat)) emitToUser(id, "chat:read", payload);
  return payload;
}

/** "Delete for everyone" - only the sender, and the media file is shredded immediately. */
export async function deleteMessage(messageId, userId) {
  const message = await Message.findById(messageId);
  if (!message || message.deletedAt) throw notFound("Message not found");
  const chat = await getChatForMember(message.chat, userId); // outsiders get 404 - never confirm a message exists
  if (idStr(message.sender) !== userId.toString()) throw forbidden("You can only delete your own messages");

  const key = message.media?.key;
  message.deletedAt = new Date();
  message.text = "";
  message.sticker = undefined;
  if (message.media) {
    message.media.key = null;
    message.media.purgedAt = new Date();
    message.media.blur = undefined;
  }
  message.legacyMediaUrl = undefined;
  await message.save();
  if (key) await storage.removeKey(key).catch((e) => logger.warn({ err: e }, "failed to remove media"));

  await Chat.updateOne({ _id: chat._id, "lastMessage._id": message._id }, { $set: { "lastMessage.kind": "deleted", "lastMessage.preview": "" } });
  const payload = { chatId: idStr(chat), messageId: idStr(message) };
  for (const id of memberIds(chat)) emitToUser(id, "message:deleted", payload);
  return payload;
}

/**
 * Issues a short-lived URL for a message's media.
 * For view-once / view-twice media this ATOMICALLY consumes one view, so two
 * concurrent requests can never get more views than the sender allowed.
 */
export async function grantMediaView(messageId, userId) {
  const message = await Message.findById(messageId).select("chat sender kind media deletedAt");
  if (!message || message.deletedAt || !message.media) throw notFound("Media not found");
  const chat = await getChatForMember(message.chat, userId);
  const md = message.media;
  if (!md.key || md.purgedAt) throw new AppError(410, "This media has expired");

  const policy = md.viewPolicy ?? "unlimited";
  const isSender = idStr(message.sender) === userId.toString();

  if (policy === "unlimited") {
    const token = signMedia(userId, messageId, OPEN_TTL);
    return { url: `/api/media/${messageId}?t=${token}`, expiresIn: OPEN_TTL };
  }
  if (isSender) throw forbidden("You can't re-open media you sent with a view limit");

  const limit = VIEW_LIMITS[policy];
  // Conditional atomic increment: MongoDB applies single-document updates atomically, so the
  // filter + $inc can never be interleaved - N simultaneous requests consume at most `limit` views.
  const field = `media.views.${userId}`;
  const res = await Message.updateOne(
    { _id: messageId, $or: [{ [field]: { $exists: false } }, { [field]: { $lt: limit } }] },
    { $inc: { [field]: 1 } },
  );
  if (res.modifiedCount !== 1) throw forbidden("This media has no views left");

  const fresh = await Message.findById(messageId).populate("sender", "name avatar");
  const others = memberIds(chat).filter((id) => id !== idStr(message.sender));
  const allDone = others.every((id) => viewCount(fresh.media, id) >= limit);
  if (allDone && !fresh.media.exhaustedAt) {
    const exhaustedAt = new Date();
    await Message.updateOne({ _id: messageId, "media.exhaustedAt": { $exists: false } }, { $set: { "media.exhaustedAt": exhaustedAt } });
    fresh.media.exhaustedAt = exhaustedAt;
  }

  // Tell the sender ("Opened") and the viewer's other devices ("1 view left").
  for (const id of [idStr(message.sender), userId.toString()]) {
    emitToUser(id, "message:updated", { message: serializeMessage(fresh, id) });
  }

  const ttl = GRANT_TTL[message.kind] ?? 60;
  return { url: `/api/media/${messageId}?t=${signMedia(userId, messageId, ttl)}`, expiresIn: ttl, viewsLeft: Math.max(0, limit - viewCount(fresh.media, userId)) };
}
