// Thin holder around the Socket.IO server + in-memory presence.
// NOTE: presence is per-process. To run several server instances, add the
// @socket.io/redis-adapter and keep presence in Redis.
let io = null;
const online = new Map(); // userId -> Set<socketId>

export const setIO = (instance) => {
  io = instance;
};
export const getIO = () => io;

export const userRoom = (id) => `user:${id}`;
export const chatRoom = (id) => `chat:${id}`;

export function emitToUser(userId, event, payload) {
  io?.to(userRoom(userId)).emit(event, payload);
}
export function emitToChat(chatId, event, payload) {
  io?.to(chatRoom(chatId)).emit(event, payload);
}

/** Emits a different payload to every member (used for viewer-specific message JSON). */
export function emitPerMember(memberIds, event, build) {
  for (const id of memberIds) emitToUser(id, event, build(id.toString()));
}

/** Puts all live sockets of these users into a chat room (after create/add). */
export function joinUsersToChat(userIds, chatId) {
  for (const id of userIds) io?.in(userRoom(id)).socketsJoin(chatRoom(chatId));
}
export function removeUsersFromChat(userIds, chatId) {
  for (const id of userIds) io?.in(userRoom(id)).socketsLeave(chatRoom(chatId));
}

export const presence = {
  add(userId, socketId) {
    const set = online.get(userId) ?? new Set();
    set.add(socketId);
    online.set(userId, set);
    return set.size === 1; // true => user just came online
  },
  remove(userId, socketId) {
    const set = online.get(userId);
    if (!set) return false;
    set.delete(socketId);
    if (set.size === 0) {
      online.delete(userId);
      return true; // true => user just went offline
    }
    return false;
  },
  isOnline: (userId) => online.has(userId.toString()),
  filterOnline: (ids) => ids.map(String).filter((id) => online.has(id)),
};

/**
 * When people become chat partners (new direct chat, new group, someone added) they are usually
 * ALREADY online, and the connect-time presence broadcast only reaches existing contacts.
 * Tell every member which of the others is currently online.
 */
export function announcePresence(memberIds) {
  const ids = [...new Set(memberIds.map(String))];
  for (const id of ids) {
    if (!presence.isOnline(id)) continue;
    for (const other of ids) if (other !== id) emitToUser(other, "presence:update", { userId: id, online: true });
  }
}
