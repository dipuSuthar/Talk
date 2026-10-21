import { useState } from "react";
import { ArrowLeft, Info } from "lucide-react";
import { useChat } from "../store/chat.js";
import { useAuth } from "../store/auth.js";
import { chatAvatarUser, chatTitle, otherMember } from "../lib/chat.js";
import { lastSeenLabel } from "../lib/format.js";
import { Avatar, IconButton, TypingDots } from "./ui.jsx";
import MessageList from "./MessageList.jsx";
import Composer from "./Composer.jsx";
import ChatInfoModal from "./ChatInfoModal.jsx";

export default function ChatWindow({ chat }) {
  const me = useAuth((s) => s.user);
  const blocked = useAuth((s) => s.blocked);
  const setActive = useChat((s) => s.setActive);
  const online = useChat((s) => s.online);
  const typingMap = useChat((s) => s.typing[chat._id]);
  const [info, setInfo] = useState(false);

  const other = chat.type === "direct" ? otherMember(chat, me._id) : null;
  const typers = Object.keys(typingMap ?? {}).filter((id) => id !== me._id);
  const typerNames = typers.map((id) => chat.members.find((m) => m.user._id === id)?.user.name.split(" ")[0]).filter(Boolean);

  let status;
  if (typerNames.length) status = <span className="flex items-center gap-1.5 text-accent"><TypingDots />{chat.type === "group" ? `${typerNames.join(", ")} typing` : "typing"}</span>;
  else if (chat.type === "group") status = `${chat.members.length} members`;
  else status = online[other?._id] ? <span className="text-emerald-500">online</span> : lastSeenLabel(other?.lastSeen);

  const blockedByMe = other && blocked[other._id];

  return (
    <section className="flex h-full min-w-0 flex-col bg-bg">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-2 py-2 safe-t sm:px-4">
        <IconButton label="Back to chats" className="md:hidden" onClick={() => setActive(null)}><ArrowLeft size={20} /></IconButton>
        <button className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left hover:bg-surface-2" onClick={() => setInfo(true)}>
          <Avatar user={chatAvatarUser(chat, me._id)} size={42} online={Boolean(other && online[other._id])} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{chatTitle(chat, me._id)}</span>
            <span className="block truncate text-xs text-muted">{status}</span>
          </span>
        </button>
        <IconButton label="Chat info" onClick={() => setInfo(true)}><Info size={20} /></IconButton>
      </header>

      <MessageList chat={chat} />
      <Composer chatId={chat._id} disabledReason={blockedByMe ? "You blocked this person. Unblock them from Chat info to send messages." : null} />
      {info && <ChatInfoModal chat={chat} onClose={() => setInfo(false)} />}
    </section>
  );
}
