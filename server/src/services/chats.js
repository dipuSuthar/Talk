import { Chat, directKeyFor } from "../models/Chat.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { idStr } from "../lib/util.js";
import { serializeChat } from "../lib/serialize.js";
import * as storage from "../lib/storage.js";
import { announcePresence, emitToUser, joinUsersToChat, removeUsersFromChat } from "./realtime.js";
import { getChatForMember } from "./messages.js";

const POPULATE = ["members.user", "name avatar about lastSeen"];
export const MAX_GROUP_SIZE = 100;

const memberIds = (chat) => chat.members.map((m) => idStr(m.user));

export async function listChats(userId) {
  const chats = await Chat.find({
    "members.user": userId,
    $or: [{ type: "group" }, { "lastMessage._id": { $exists: true } }, { createdBy: userId }],
  })
    .sort({ updatedAt: -1 })
    .limit(200)
    .populate(...POPULATE);
  return chats.map((c) => serializeChat(c, userId));
}

export async function getChat(chatId, userId) {
  const chat = await getChatForMember(chatId, userId, { populate: true });
  return serializeChat(chat, userId);
}

export async function openDirectChat(userId, otherId) {
  if (idStr(otherId) === idStr(userId)) throw badRequest("You can't chat with yourself");
  const other = await User.findById(otherId).select("+blocked");
  if (!other) throw notFound("User not found");
  const me = await User.findById(userId).select("+blocked");
  if (me.blocked.some((b) => idStr(b) === idStr(otherId))) throw forbidden("You blocked this user");
  if (other.blocked.some((b) => idStr(b) === idStr(userId))) throw forbidden("You can't message this user");

  const uniqueKey = directKeyFor(userId, otherId);
  let chat = await Chat.findOne({ uniqueKey });
  if (!chat) {
    try {
      chat = await Chat.create({
        type: "direct",
        uniqueKey,
        createdBy: userId,
        members: [{ user: userId }, { user: otherId }],
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      chat = await Chat.findOne({ uniqueKey }); // lost a creation race: use the winner
    }
  }
  joinUsersToChat([idStr(userId), idStr(otherId)], chat._id);
  announcePresence([userId, otherId]);
  await chat.populate(...POPULATE);
  return serializeChat(chat, userId);
}

export async function createGroup(userId, { name, userIds }) {
  const unique = [...new Set(userIds.map(idStr))].filter((id) => id !== idStr(userId));
  if (unique.length < 2) throw badRequest("Pick at least 2 other people for a group");
  if (unique.length + 1 > MAX_GROUP_SIZE) throw badRequest(`Groups are limited to ${MAX_GROUP_SIZE} members`);
  const count = await User.countDocuments({ _id: { $in: unique } });
  if (count !== unique.length) throw badRequest("One or more users do not exist");

  const chat = await Chat.create({
    type: "group",
    name,
    createdBy: userId,
    members: [{ user: userId, role: "admin" }, ...unique.map((user) => ({ user }))],
  });
  await chat.populate(...POPULATE);
  const ids = memberIds(chat);
  joinUsersToChat(ids, chat._id);
  for (const id of ids) emitToUser(id, "chat:new", { chat: serializeChat(chat, id) });
  announcePresence(ids);
  return serializeChat(chat, userId);
}

function requireGroupAdmin(chat, userId) {
  if (chat.type !== "group") throw badRequest("This action is only for group chats");
  const me = chat.members.find((m) => idStr(m.user) === idStr(userId));
  if (me?.role !== "admin") throw forbidden("Only group admins can do this");
}

async function broadcastUpdate(chatId) {
  const chat = await Chat.findById(chatId).populate(...POPULATE);
  for (const id of memberIds(chat)) emitToUser(id, "chat:updated", { chat: serializeChat(chat, id) });
  return chat;
}

export async function renameGroup(chatId, userId, name) {
  const chat = await getChatForMember(chatId, userId);
  requireGroupAdmin(chat, userId);
  chat.name = name;
  await chat.save();
  return serializeChat(await broadcastUpdate(chat._id), userId);
}

export async function addMembers(chatId, userId, userIds) {
  const chat = await getChatForMember(chatId, userId);
  requireGroupAdmin(chat, userId);
  const existing = new Set(memberIds(chat));
  const fresh = [...new Set(userIds.map(idStr))].filter((id) => !existing.has(id));
  if (!fresh.length) throw badRequest("Those people are already in the group");
  if (existing.size + fresh.length > MAX_GROUP_SIZE) throw badRequest(`Groups are limited to ${MAX_GROUP_SIZE} members`);
  if ((await User.countDocuments({ _id: { $in: fresh } })) !== fresh.length) throw badRequest("One or more users do not exist");
  await Chat.updateOne({ _id: chat._id }, { $push: { members: { $each: fresh.map((user) => ({ user })) } } });
  joinUsersToChat(fresh, chat._id);
  const updated = await broadcastUpdate(chat._id);
  announcePresence(memberIds(updated));
  // New members need the chat in their list even though they weren't sent chat:updated before joining.
  return serializeChat(updated, userId);
}

export async function removeMember(chatId, actorId, targetId) {
  const chat = await getChatForMember(chatId, actorId);
  if (chat.type !== "group") throw badRequest("You can't leave a direct chat");
  const self = idStr(actorId) === idStr(targetId);
  if (!self) requireGroupAdmin(chat, actorId);
  if (!memberIds(chat).includes(idStr(targetId))) throw notFound("That person is not in the group");

  const remaining = chat.members.filter((m) => idStr(m.user) !== idStr(targetId));
  if (remaining.length === 0) {
    await deleteChatCascade(chat);
    emitToUser(idStr(targetId), "chat:removed", { chatId: idStr(chat) });
    return { removed: true, chatDeleted: true };
  }
  // Never leave a group without an admin.
  if (!remaining.some((m) => m.role === "admin")) remaining[0].role = "admin";
  chat.members = remaining;
  await chat.save();

  removeUsersFromChat([idStr(targetId)], chat._id);
  emitToUser(idStr(targetId), "chat:removed", { chatId: idStr(chat) });
  await broadcastUpdate(chat._id);
  return { removed: true };
}

async function deleteChatCascade(chat) {
  const withMedia = await Message.find({ chat: chat._id, "media.key": { $ne: null } }).select("media.key").lean();
  await Promise.all(withMedia.map((m) => storage.removeKey(m.media.key).catch(() => {})));
  await Message.deleteMany({ chat: chat._id });
  await Chat.deleteOne({ _id: chat._id });
}
