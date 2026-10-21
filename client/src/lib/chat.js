export const otherMember = (chat, meId) => chat.members.find((m) => m.user._id !== meId)?.user;
export const chatTitle = (chat, meId) => (chat.type === "group" ? chat.name : otherMember(chat, meId)?.name ?? "Unknown");
export const chatAvatarUser = (chat, meId) => (chat.type === "group" ? { name: chat.name, avatar: null, _id: chat._id } : otherMember(chat, meId) ?? { name: "?" });
export const isAdmin = (chat, meId) => chat.members.find((m) => m.user._id === meId)?.role === "admin";

const KIND_LABEL = { image: "📷 Photo", gif: "GIF", video: "🎥 Video", sticker: "Sticker", deleted: "🚫 Message deleted" };
export function previewText(chat, meId) {
  const lm = chat.lastMessage;
  if (!lm) return chat.type === "group" ? "No messages yet" : "Say hello 👋";
  const mine = lm.sender === meId;
  const who = chat.type === "group" && !mine ? `${chat.members.find((m) => m.user._id === lm.sender)?.user.name?.split(" ")[0] ?? ""}: ` : mine ? "You: " : "";
  return who + (lm.kind === "text" ? lm.preview : KIND_LABEL[lm.kind] ?? "");
}
