import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { useChat, totalUnread } from "../store/chat.js";
import { useAuth } from "../store/auth.js";
import { connectSocket, disconnectSocket } from "../lib/socket.js";
import Sidebar from "../components/Sidebar.jsx";
import ChatWindow from "../components/ChatWindow.jsx";

export default function ChatPage({ theme, toggleTheme }) {
  const activeId = useChat((s) => s.activeId);
  const chats = useChat((s) => s.chats);
  const loadChats = useChat((s) => s.loadChats);
  const loadBlocked = useAuth((s) => s.loadBlocked);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    useChat.getState().reset();
    connectSocket(useChat.getState().handlers);
    loadChats().then(() => setReady(true));
    loadBlocked();
    return () => {
      disconnectSocket();
      useChat.getState().reset();
    };
  }, [loadChats, loadBlocked]);

  // unread count in the tab title; mark the open chat as read when the tab regains focus
  const unread = totalUnread(chats);
  useEffect(() => {
    document.title = unread ? `(${unread}) Talk` : "Talk";
  }, [unread]);
  useEffect(() => {
    const onVis = () => document.visibilityState === "visible" && activeId && useChat.getState().markRead(activeId);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [activeId]);

  const active = chats.find((c) => c._id === activeId);
  return (
    <div className="grid h-dvh overflow-hidden md:grid-cols-[minmax(300px,380px)_1fr]">
      <div className={`${active ? "hidden md:block" : "block"} min-h-0`}><Sidebar theme={theme} toggleTheme={toggleTheme} /></div>
      <main className={`${active ? "block" : "hidden md:grid"} min-h-0 min-w-0`}>
        {active ? (
          <ChatWindow key={active._id} chat={active} />
        ) : (
          <div className="grid h-full place-items-center bg-bg px-6 text-center text-muted">
            <div>
              <span className="mx-auto grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-white shadow-lg"><MessageCircle size={36} /></span>
              <h2 className="mt-5 text-2xl font-bold text-ink">{ready ? "Pick a conversation" : "Loading…"}</h2>
              <p className="mt-1 text-sm">Send messages, photos, stickers — or a photo that disappears after one view.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
