import { create } from "zustand";
import { api, errMsg } from "../lib/api.js";
import { emit } from "../lib/socket.js";
import { uid } from "../lib/format.js";
import { useAuth } from "./auth.js";
import { toast } from "./toast.js";

const START_INDEX = 1_000_000; // react-virtuoso "firstItemIndex" base, lets us prepend history without scroll jumps
const PAGE = 30;
const me = () => useAuth.getState().user;

const sortChats = (chats) => [...chats].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
const typingTimers = new Map();
let readInFlight = new Set();

const emptyBucket = () => ({ items: [], hasMore: true, loading: false, loaded: false, first: START_INDEX });

export const useChat = create((set, get) => ({
  chats: [],
  chatsLoaded: false,
  messages: {}, // chatId -> bucket
  activeId: null,
  typing: {}, // chatId -> { userId: true }
  online: {}, // userId -> true
  connected: false,

  // ---------- chats ----------
  async loadChats() {
    try {
      const { data } = await api.get("/chats");
      set({ chats: sortChats(data), chatsLoaded: true });
    } catch (e) {
      set({ chatsLoaded: true });
      toast.error(errMsg(e, "Couldn't load your chats"));
    }
  },

  upsertChat(chat) {
    set((s) => {
      const exists = s.chats.some((c) => c._id === chat._id);
      const chats = exists ? s.chats.map((c) => (c._id === chat._id ? { ...c, ...chat } : c)) : [chat, ...s.chats];
      return { chats: sortChats(chats) };
    });
  },

  async openDirect(userId) {
    const { data } = await api.post("/chats/direct", { userId });
    get().upsertChat(data);
    get().setActive(data._id);
    return data;
  },
  async createGroup(name, userIds) {
    const { data } = await api.post("/chats/group", { name, userIds });
    get().upsertChat(data);
    get().setActive(data._id);
    return data;
  },

  setActive(id) {
    set({ activeId: id });
    if (id) get().ensureMessages(id).then(() => get().markRead(id));
  },

  // ---------- messages ----------
  async ensureMessages(chatId) {
    const bucket = get().messages[chatId];
    if (bucket?.loaded) return;
    await get().loadLatest(chatId);
  },

  async loadLatest(chatId) {
    set((s) => ({ messages: { ...s.messages, [chatId]: { ...(s.messages[chatId] ?? emptyBucket()), loading: true } } }));
    try {
      const { data } = await api.get(`/chats/${chatId}/messages`, { params: { limit: PAGE } });
      set((s) => {
        // keep any in-flight optimistic messages the user just sent
        const pending = (s.messages[chatId]?.items ?? []).filter((m) => m.status === "sending" || m.status === "failed");
        return {
          messages: {
            ...s.messages,
            [chatId]: { items: [...data.messages, ...pending], hasMore: data.hasMore, loading: false, loaded: true, first: START_INDEX },
          },
        };
      });
    } catch (e) {
      set((s) => ({ messages: { ...s.messages, [chatId]: { ...(s.messages[chatId] ?? emptyBucket()), loading: false } } }));
      toast.error(errMsg(e, "Couldn't load messages"));
    }
  },

  async loadOlder(chatId) {
    const b = get().messages[chatId];
    if (!b || b.loading || !b.hasMore) return;
    const oldest = b.items.find((m) => !String(m._id).startsWith("tmp-"));
    if (!oldest) return;
    set((s) => ({ messages: { ...s.messages, [chatId]: { ...s.messages[chatId], loading: true } } }));
    try {
      const { data } = await api.get(`/chats/${chatId}/messages`, { params: { limit: PAGE, before: oldest._id } });
      set((s) => {
        const cur = s.messages[chatId];
        const known = new Set(cur.items.map((m) => m._id));
        const fresh = data.messages.filter((m) => !known.has(m._id));
        return {
          messages: {
            ...s.messages,
            [chatId]: { ...cur, items: [...fresh, ...cur.items], hasMore: data.hasMore, loading: false, first: cur.first - fresh.length },
          },
        };
      });
    } catch (e) {
      set((s) => ({ messages: { ...s.messages, [chatId]: { ...s.messages[chatId], loading: false } } }));
      toast.error(errMsg(e));
    }
  },

  _mutate(chatId, fn) {
    set((s) => {
      const b = s.messages[chatId];
      if (!b) return s;
      return { messages: { ...s.messages, [chatId]: { ...b, items: fn(b.items) } } };
    });
  },

  _addOrReplace(chatId, message) {
    get()._mutate(chatId, (items) => {
      const i = items.findIndex((m) => m._id === message._id || (message.clientId && m.clientId === message.clientId));
      if (i >= 0) {
        const next = items.slice();
        next[i] = { ...next[i], ...message, status: undefined, localUrl: next[i].localUrl, progress: undefined };
        return next;
      }
      return [...items, message];
    });
  },

  // ---------- sending (optimistic) ----------
  async _send(chatId, optimistic, buildRequest) {
    const clientId = optimistic.clientId;
    const msg = { ...optimistic, _id: `tmp-${clientId}`, chat: chatId, sender: me(), createdAt: new Date().toISOString(), readBy: [], status: "sending" };
    get()._addOrReplace(chatId, msg);
    get().upsertChat({ _id: chatId, updatedAt: msg.createdAt });
    try {
      const { data } = await buildRequest((progress) => get()._mutate(chatId, (items) => items.map((m) => (m.clientId === clientId ? { ...m, progress } : m))));
      get()._addOrReplace(chatId, data.message);
      if (msg.localUrl) setTimeout(() => URL.revokeObjectURL(msg.localUrl), 5000);
    } catch (e) {
      const reason = errMsg(e, "Failed to send");
      get()._mutate(chatId, (items) => items.map((m) => (m.clientId === clientId ? { ...m, status: "failed", error: reason, progress: undefined } : m)));
      toast.error(reason);
    }
  },

  sendText(chatId, text) {
    const clientId = uid();
    return get()._send(chatId, { clientId, kind: "text", text, _retry: { type: "text", text } }, () => api.post(`/chats/${chatId}/messages`, { text, clientId }));
  },

  sendSticker(chatId, pack, id) {
    const clientId = uid();
    return get()._send(chatId, { clientId, kind: "sticker", sticker: { pack, id }, text: "", _retry: { type: "sticker", pack, id } }, () =>
      api.post(`/chats/${chatId}/messages`, { kind: "sticker", stickerPack: pack, stickerId: id, clientId }),
    );
  },

  sendMedia(chatId, file, { viewPolicy = "unlimited", text = "", kind } = {}) {
    const clientId = uid();
    const isVideo = file.type.startsWith("video/");
    const isGif = file.type === "image/gif";
    const msgKind = kind === "sticker" ? "sticker" : isVideo ? "video" : isGif ? "gif" : "image";
    const localUrl = URL.createObjectURL(file);
    const optimistic = {
      clientId,
      kind: msgKind,
      text,
      localUrl,
      media: { viewPolicy, mime: file.type, openedBy: [], local: true },
      _retry: { type: "media", file, viewPolicy, text, kind },
    };
    return get()._send(chatId, optimistic, (onProgress) => {
      const form = new FormData();
      form.append("file", file);
      form.append("clientId", clientId);
      form.append("viewPolicy", viewPolicy);
      if (kind) form.append("kind", kind);
      if (text) form.append("text", text);
      return api.post(`/chats/${chatId}/messages`, form, {
        timeout: 5 * 60_000,
        onUploadProgress: (e) => e.total && onProgress(Math.round((e.loaded / e.total) * 100)),
      });
    });
  },

  retry(chatId, clientId) {
    const m = get().messages[chatId]?.items.find((x) => x.clientId === clientId);
    if (!m?._retry) return;
    get()._mutate(chatId, (items) => items.filter((x) => x.clientId !== clientId));
    const r = m._retry;
    if (r.type === "text") return get().sendText(chatId, r.text);
    if (r.type === "sticker") return get().sendSticker(chatId, r.pack, r.id);
    return get().sendMedia(chatId, r.file, r);
  },

  discard(chatId, clientId) {
    get()._mutate(chatId, (items) => items.filter((x) => x.clientId !== clientId));
  },

  async deleteMessage(chatId, messageId) {
    try {
      await api.delete(`/messages/${messageId}`);
    } catch (e) {
      toast.error(errMsg(e, "Couldn't delete message"));
    }
  },

  // ---------- read receipts ----------
  async markRead(chatId) {
    const chat = get().chats.find((c) => c._id === chatId);
    if (!chat || readInFlight.has(chatId)) return;
    const hasUnread = chat.unread > 0 || get().messages[chatId]?.items.some((m) => m.sender?._id !== me()?._id && !m.readBy?.includes(me()?._id));
    if (!hasUnread) return;
    readInFlight.add(chatId);
    get().upsertChat({ _id: chatId, unread: 0 });
    try {
      await api.post(`/chats/${chatId}/read`);
    } catch {
      /* will retry next time the chat is focused */
    } finally {
      readInFlight.delete(chatId);
    }
  },

  async setTyping(chatId, isTyping) {
    emit(isTyping ? "typing:start" : "typing:stop", { chatId });
  },

  // ---------- socket event handlers ----------
  handlers: {
    connect: () => {
      const wasConnected = get().connected;
      set({ connected: true });
      if (wasConnected === false && get().chatsLoaded) {
        // came back after being offline: resync what we may have missed
        get().loadChats();
        const id = get().activeId;
        if (id) get().loadLatest(id).then(() => get().markRead(id));
      }
    },
    disconnect: () => set({ connected: false }),

    "message:new": async ({ message, chat }) => {
      const known = get().chats.some((c) => c._id === message.chat);
      if (!known) {
        try {
          const { data } = await api.get(`/chats/${message.chat}`);
          get().upsertChat(data);
        } catch {
          return;
        }
      }
      get().upsertChat(chat);
      if (get().messages[message.chat]?.loaded) get()._addOrReplace(message.chat, message);
      if (get().activeId === message.chat && document.visibilityState === "visible" && message.sender._id !== me()?._id) {
        get().markRead(message.chat);
      }
    },

    "message:updated": ({ message }) => get()._addOrReplace(message.chat, message),

    "message:deleted": ({ chatId, messageId }) => {
      get()._mutate(chatId, (items) =>
        items.map((m) => (m._id === messageId ? { ...m, deleted: true, text: "", media: undefined, sticker: undefined } : m)),
      );
      const chat = get().chats.find((c) => c._id === chatId);
      if (chat?.lastMessage?._id === messageId) get().upsertChat({ _id: chatId, lastMessage: { ...chat.lastMessage, kind: "deleted", preview: "" } });
    },

    "chat:read": ({ chatId, userId }) => {
      if (userId === me()?._id) return get().upsertChat({ _id: chatId, unread: 0 });
      get()._mutate(chatId, (items) =>
        items.map((m) => (m.sender?._id !== userId && !m.readBy?.includes(userId) ? { ...m, readBy: [...(m.readBy ?? []), userId] } : m)),
      );
    },

    "chat:new": ({ chat }) => get().upsertChat(chat),
    "chat:updated": ({ chat }) => get().upsertChat(chat),
    "chat:removed": ({ chatId }) =>
      set((s) => ({ chats: s.chats.filter((c) => c._id !== chatId), activeId: s.activeId === chatId ? null : s.activeId })),

    "presence:snapshot": ({ online }) => set({ online: Object.fromEntries(online.map((id) => [id, true])) }),
    "presence:update": ({ userId, online, lastSeen }) => {
      set((s) => {
        const next = { ...s.online };
        if (online) next[userId] = true;
        else delete next[userId];
        return { online: next };
      });
      if (!online) {
        set((s) => ({
          chats: s.chats.map((c) => ({ ...c, members: c.members.map((m) => (m.user._id === userId ? { ...m, user: { ...m.user, lastSeen } } : m)) })),
        }));
      }
    },

    typing: ({ chatId, userId, isTyping }) => {
      const key = `${chatId}:${userId}`;
      clearTimeout(typingTimers.get(key));
      const apply = (on) =>
        set((s) => {
          const cur = { ...(s.typing[chatId] ?? {}) };
          if (on) cur[userId] = true;
          else delete cur[userId];
          return { typing: { ...s.typing, [chatId]: cur } };
        });
      apply(isTyping);
      // safety net: if the "stop" event is lost, clear after 5s
      if (isTyping) typingTimers.set(key, setTimeout(() => apply(false), 5000));
    },
  },

  reset() {
    readInFlight = new Set();
    typingTimers.forEach(clearTimeout);
    typingTimers.clear();
    set({ chats: [], chatsLoaded: false, messages: {}, activeId: null, typing: {}, online: {}, connected: false });
  },
}));

export const totalUnread = (chats) => chats.reduce((n, c) => n + (c.unread || 0), 0);
