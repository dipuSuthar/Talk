import { useMemo, useState } from "react";
import { Plus, Search, Moon, Sun, WifiOff } from "lucide-react";
import { useChat } from "../store/chat.js";
import { useAuth } from "../store/auth.js";
import { chatAvatarUser, chatTitle, otherMember, previewText } from "../lib/chat.js";
import { listTime } from "../lib/format.js";
import { Avatar, IconButton, Spinner, TypingDots } from "./ui.jsx";
import NewChatModal from "./NewChatModal.jsx";
import ProfileModal from "./ProfileModal.jsx";

function Row({ chat, active, meId }) {
  const setActive = useChat((s) => s.setActive);
  const online = useChat((s) => s.online);
  const typing = useChat((s) => s.typing[chat._id]);
  const other = chat.type === "direct" ? otherMember(chat, meId) : null;
  const isTyping = Object.keys(typing ?? {}).some((id) => id !== meId);
  return (
    <li>
      <button onClick={() => setActive(chat._id)} aria-current={active} className={`flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition hover:bg-surface-2 ${active ? "bg-accent/12 ring-1 ring-accent/30" : ""}`}>
        <Avatar user={chatAvatarUser(chat, meId)} size={48} online={Boolean(other && online[other._id])} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold">{chatTitle(chat, meId)}</span>
            <span className={`shrink-0 text-xs ${chat.unread ? "font-semibold text-accent" : "text-muted"}`}>{listTime(chat.lastMessage?.createdAt ?? chat.updatedAt)}</span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className={`truncate text-sm ${chat.unread ? "font-medium text-ink" : "text-muted"}`}>{isTyping ? <span className="flex items-center gap-1.5 text-accent"><TypingDots /> typing</span> : previewText(chat, meId)}</span>
            {chat.unread > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-ink">{chat.unread > 99 ? "99+" : chat.unread}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

export default function Sidebar({ theme, toggleTheme }) {
  const me = useAuth((s) => s.user);
  const chats = useChat((s) => s.chats);
  const loaded = useChat((s) => s.chatsLoaded);
  const activeId = useChat((s) => s.activeId);
  const connected = useChat((s) => s.connected);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? chats.filter((c) => chatTitle(c, me._id).toLowerCase().includes(t)) : chats;
  }, [chats, q, me._id]);

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2 p-3 safe-t">
        <button onClick={() => setModal("profile")} aria-label="Your profile" className="rounded-full"><Avatar user={me} size={40} /></button>
        <h1 className="flex-1 text-xl font-bold">Chats</h1>
        <IconButton label={theme === "dark" ? "Light mode" : "Dark mode"} onClick={toggleTheme}>{theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}</IconButton>
        <IconButton label="New chat" className="!bg-accent !text-accent-ink hover:!brightness-110" onClick={() => setModal("new")}><Plus size={20} /></IconButton>
      </div>
      {!connected && <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-600"><WifiOff size={14} /> Reconnecting…</div>}
      <div className="relative px-3 pb-2">
        <Search size={16} className="absolute top-1/2 left-6 -translate-y-[65%] text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" className="w-full rounded-xl bg-surface-2 py-2.5 pr-3 pl-9 text-sm outline-none focus:ring-2 focus:ring-accent/40" />
      </div>
      <ul className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {!loaded && <li className="grid place-items-center py-10 text-muted"><Spinner size={24} /></li>}
        {loaded && !filtered.length && (
          <li className="px-4 py-12 text-center text-sm text-muted">{q ? "No chats match your search." : <>No conversations yet.<br /><button className="mt-2 font-semibold text-accent" onClick={() => setModal("new")}>Start one</button></>}</li>
        )}
        {filtered.map((c) => <Row key={c._id} chat={c} active={c._id === activeId} meId={me._id} />)}
      </ul>
      {modal === "new" && <NewChatModal onClose={() => setModal(null)} />}
      {modal === "profile" && <ProfileModal onClose={() => setModal(null)} />}
    </aside>
  );
}
