import { signMedia } from "./tokens.js";
import { idStr } from "./util.js";

export const VIEW_LIMITS = { once: 1, twice: 2 };
export const GRANT_TTL = { image: 60, gif: 60, sticker: 60, video: 600 }; // seconds, for view-limited media
export const OPEN_TTL = 3600; // normal media URLs

export const userBrief = (u) =>
  u && {
    _id: idStr(u),
    name: u.name,
    avatar: u.avatar ?? null,
    about: u.about ?? "",
    lastSeen: u.lastSeen ?? null,
  };

export function serializeChat(chat, viewerId) {
  const c = chat.toObject ? chat.toObject() : chat;
  const unread = c.unread instanceof Map ? c.unread.get(viewerId.toString()) : c.unread?.[viewerId.toString()];
  return {
    _id: idStr(c),
    type: c.type,
    name: c.name ?? null,
    createdBy: idStr(c.createdBy),
    members: c.members.map((m) => ({ user: userBrief(m.user), role: m.role })),
    lastMessage: c.lastMessage?._id
      ? { ...c.lastMessage, _id: idStr(c.lastMessage._id), sender: idStr(c.lastMessage.sender) }
      : null,
    unread: unread ?? 0,
    updatedAt: c.updatedAt,
    createdAt: c.createdAt,
  };
}

/** Builds the viewer-specific JSON for a message. Storage keys never leave the server. */
export function serializeMessage(msg, viewerId) {
  const m = msg.toObject ? msg.toObject() : msg;
  const viewer = viewerId.toString();
  const senderId = idStr(m.sender);
  const isSender = senderId === viewer;

  const out = {
    _id: idStr(m),
    chat: idStr(m.chat),
    sender: typeof m.sender === "object" && m.sender?.name ? userBrief(m.sender) : { _id: senderId },
    kind: m.kind,
    text: m.text ?? "",
    sticker: m.sticker?.id ? m.sticker : undefined,
    readBy: (m.readBy ?? []).map(idStr),
    clientId: m.clientId,
    createdAt: m.createdAt,
    deleted: Boolean(m.deletedAt),
  };

  if (out.deleted) {
    out.text = "";
    out.sticker = undefined;
    return out;
  }

  if (m.legacyMediaUrl) {
    out.media = { legacy: true, url: m.legacyMediaUrl, viewPolicy: "unlimited" };
    out.kind = out.kind === "text" ? "image" : out.kind;
    return out;
  }

  if (m.media) {
    const md = m.media;
    const policy = md.viewPolicy ?? "unlimited";
    const purged = !md.key || Boolean(md.purgedAt);
    const media = {
      mime: md.mime,
      width: md.width,
      height: md.height,
      viewPolicy: policy,
      purged,
    };

    if (policy === "unlimited") {
      media.blur = md.blur;
      if (!purged) media.url = `/api/media/${out._id}?t=${signMedia(viewer, out._id, OPEN_TTL)}`;
    } else if (isSender) {
      // Senders can't re-open their own disappearing media; they only see its status.
      media.openedBy = openedByList(md);
    } else {
      media.viewsLeft = Math.max(0, VIEW_LIMITS[policy] - viewCount(md, viewer));
      if (media.viewsLeft > 0) media.blur = md.blur;
    }
    out.media = media;
  }
  return out;
}

/** How many times `userId` has opened this media (handles Map docs and lean plain objects). */
export const viewCount = (media, userId) => {
  const v = media?.views;
  const id = userId.toString();
  return (v instanceof Map ? v.get(id) : v?.[id]) ?? 0;
};
const openedByList = (media) => {
  const v = media?.views;
  const entries = v instanceof Map ? [...v.entries()] : Object.entries(v ?? {});
  return entries.filter(([, n]) => n > 0).map(([id]) => id);
};

export const previewFor = (msg) => (msg.kind === "text" ? (msg.text ?? "").slice(0, 120) : "");
