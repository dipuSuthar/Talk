import { Server } from "socket.io";
import { clientOrigins } from "../config/env.js";
import { verifyAccess } from "../lib/tokens.js";
import { Chat } from "../models/Chat.js";
import { User } from "../models/User.js";
import { logger } from "../lib/logger.js";
import { chatRoom, userRoom, presence, setIO, emitToUser } from "../services/realtime.js";

/** Tiny per-socket token bucket so a client can't spam typing events. */
function makeLimiter(max, perMs) {
  let tokens = max;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(max, tokens + ((now - last) / perMs) * max);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

async function contactIdsOf(userId) {
  const chats = await Chat.find({ "members.user": userId }).select("members.user").lean();
  const ids = new Set();
  for (const c of chats) for (const m of c.members) ids.add(m.user.toString());
  ids.delete(userId);
  return [...ids];
}

export function attachSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: clientOrigins, credentials: true },
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 1e5, // 100 KB: binary media never goes over the socket
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000 },
  });
  setIO(io);

  // Authenticate every connection with the same short-lived access token as the REST API.
  io.use((socket, next) => {
    try {
      socket.data.userId = verifyAccess(String(socket.handshake.auth?.token ?? "")).sub;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    const allow = makeLimiter(12, 5000);
    let announced = false; // did we count this socket as "online"?

    // All handlers are registered synchronously so early events are never dropped;
    // they simply wait for the async setup below to finish.
    const ready = (async () => {
      socket.join(userRoom(userId));
      const chats = await Chat.find({ "members.user": userId }).select("_id").lean();
      for (const c of chats) socket.join(chatRoom(c._id.toString()));
      const contacts = await contactIdsOf(userId);
      if (socket.disconnected) return; // left while we were setting up: don't mark online
      socket.emit("presence:snapshot", { online: presence.filterOnline(contacts) });
      announced = true;
      if (presence.add(userId, socket.id)) {
        for (const id of contacts) emitToUser(id, "presence:update", { userId, online: true });
      }
    })().catch((err) => {
      logger.error({ err }, "socket setup failed");
      socket.disconnect(true);
    });

    // Typing: the server checks membership; the client only says *where* it is typing.
    const typing = (isTyping) => async (payload) => {
      await ready;
      const chatId = String(payload?.chatId ?? "");
      if (!allow()) return;
      if (!socket.rooms.has(chatRoom(chatId))) return; // not a member -> ignore
      socket.to(chatRoom(chatId)).emit("typing", { chatId, userId, isTyping });
    };
    socket.on("typing:start", typing(true));
    socket.on("typing:stop", typing(false));

    socket.on("disconnect", async () => {
      await ready;
      if (!announced || !presence.remove(userId, socket.id)) return;
      const lastSeen = new Date();
      try {
        await User.updateOne({ _id: userId }, { $set: { lastSeen } });
        for (const id of await contactIdsOf(userId)) emitToUser(id, "presence:update", { userId, online: false, lastSeen });
      } catch (err) {
        logger.warn({ err }, "presence update failed");
      }
    });
  });

  return io;
}
