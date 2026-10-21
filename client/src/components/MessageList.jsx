import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Check, CheckCheck, Clock, AlertCircle, Trash2, RotateCw, Ban } from "lucide-react";
import { useChat } from "../store/chat.js";
import { useAuth } from "../store/auth.js";
import { dayLabel, formatTime, sameDay } from "../lib/format.js";
import { Avatar, Spinner } from "./ui.jsx";
import { MessageMedia, Lightbox, ViewOnceViewer } from "./Media.jsx";

const Ticks = ({ message, chat, meId }) => {
  if (message.status === "sending") return <Clock size={12} aria-label="Sending" />;
  if (message.status === "failed") return <AlertCircle size={12} aria-label="Failed" />;
  const others = chat.members.filter((m) => m.user._id !== meId).length;
  const read = others > 0 && message.readBy.filter((id) => id !== meId).length >= others;
  return read ? <CheckCheck size={14} className="text-cyan-300" aria-label="Read" /> : <Check size={14} aria-label="Sent" />;
};

const Bubble = memo(function Bubble({ message, prev, chat, meId, onLightbox, onViewer }) {
  const mine = message.sender?._id === meId;
  const isGroup = chat.type === "group";
  const newDay = !prev || !sameDay(prev.createdAt, message.createdAt);
  const groupedWithPrev = prev && !newDay && prev.sender?._id === message.sender?._id && !prev.deleted;
  const bare = message.kind === "sticker" || message.sticker; // stickers float without a bubble
  const del = useChat((s) => s.deleteMessage);
  const retry = useChat((s) => s.retry);
  const discard = useChat((s) => s.discard);
  const [menu, setMenu] = useState(false);

  const body = message.deleted ? (
    <span className="flex items-center gap-1.5 text-sm italic opacity-70"><Ban size={14} /> This message was deleted</span>
  ) : (
    <>
      {(message.media || message.sticker || message.localUrl) && <MessageMedia message={message} mine={mine} onLightbox={onLightbox} onViewer={onViewer} />}
      {message.text && <p className={`whitespace-pre-wrap break-words ${message.media ? "mt-1.5" : ""}`}>{message.text}</p>}
    </>
  );

  return (
    <div className={`px-3 sm:px-6 ${groupedWithPrev ? "pt-0.5" : "pt-2.5"}`}>
      {newDay && <div className="my-3 flex justify-center"><span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">{dayLabel(message.createdAt)}</span></div>}
      <div className={`group flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
        {!mine && isGroup ? (groupedWithPrev ? <span className="w-8 shrink-0" /> : <Avatar user={message.sender} size={32} />) : null}
        <div className={`relative flex max-w-[82%] flex-col sm:max-w-[68%] ${mine ? "items-end" : "items-start"}`}>
          {!mine && isGroup && !groupedWithPrev && !bare && <span className="mb-0.5 ml-1 text-xs font-semibold text-accent">{message.sender?.name}</span>}
          <div
            onContextMenu={(e) => { if (mine && !message.deleted && !message.status) { e.preventDefault(); setMenu((v) => !v); } }}
            className={bare && !message.deleted ? "py-1" : `rounded-2xl px-3 py-2 text-[15px] leading-snug shadow-sm ${mine ? "rounded-br-md bg-bubble-out text-white" : "rounded-bl-md bg-bubble-in text-ink"} ${message.status === "failed" ? "ring-2 ring-danger" : ""}`}
          >
            {body}
            {!bare && !message.deleted && (
              <span className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${mine ? "text-white/70" : "text-muted"}`}>
                {formatTime(message.createdAt)}
                {mine && <Ticks message={message} chat={chat} meId={meId} />}
              </span>
            )}
          </div>
          {bare && !message.deleted && <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">{formatTime(message.createdAt)}{mine && <Ticks message={message} chat={chat} meId={meId} />}</span>}

          {message.status === "failed" && (
            <div className="mt-1 flex items-center gap-3 text-xs text-danger">
              <span>{message.error || "Not sent"}</span>
              <button className="flex items-center gap-1 font-semibold hover:underline" onClick={() => retry(chat._id, message.clientId)}><RotateCw size={12} />Retry</button>
              <button className="font-semibold hover:underline" onClick={() => discard(chat._id, message.clientId)}>Discard</button>
            </div>
          )}

          {mine && !message.deleted && !message.status && (
            <button
              aria-label="Delete for everyone"
              title="Delete for everyone"
              onClick={() => { if (window.confirm("Delete this message for everyone?")) del(chat._id, message._id); setMenu(false); }}
              className={`absolute top-1 ${mine ? "-left-9" : "-right-9"} grid size-8 place-items-center rounded-full bg-surface text-muted opacity-0 shadow transition group-hover:opacity-100 hover:text-danger focus:opacity-100 ${menu ? "opacity-100" : ""}`}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export default function MessageList({ chat }) {
  const meId = useAuth((s) => s.user._id);
  const bucket = useChat((s) => s.messages[chat._id]);
  const loadOlder = useChat((s) => s.loadOlder);
  const [lightbox, setLightbox] = useState(null);
  const [viewer, setViewer] = useState(null);
  const atBottom = useRef(true);

  const items = useMemo(() => bucket?.items ?? [], [bucket?.items]);
  const first = bucket?.first ?? 1_000_000;
  const onStart = useCallback(() => loadOlder(chat._id), [loadOlder, chat._id]);
  const closeViewer = useCallback(() => setViewer(null), []);
  const closeLightbox = useCallback(() => setLightbox(null), []);

  // Keep the viewer's message fresh (views left) without re-opening it.
  const viewerMsg = useMemo(() => viewer && items.find((m) => m._id === viewer._id) && viewer, [viewer, items]);

  if (!bucket?.loaded) return <div className="grid flex-1 place-items-center text-muted"><Spinner size={28} /></div>;
  if (items.length === 0) {
    return <div className="grid flex-1 place-items-center px-6 text-center text-muted"><div><p className="text-4xl">👋</p><p className="mt-2 font-medium text-ink">No messages yet</p><p className="text-sm">Send the first message, a photo or a sticker.</p></div></div>;
  }

  return (
    <>
      <Virtuoso
        className="scroll-thin flex-1"
        data={items}
        firstItemIndex={first}
        initialTopMostItemIndex={items.length - 1}
        alignToBottom
        startReached={onStart}
        atBottomStateChange={(b) => (atBottom.current = b)}
        followOutput={(isAtBottom) => (isAtBottom ? "smooth" : false)}
        increaseViewportBy={{ top: 400, bottom: 200 }}
        computeItemKey={(_i, m) => m.clientId || m._id}
        components={{ Header: () => <div className="grid h-8 place-items-center text-muted">{bucket.loading ? <Spinner size={16} /> : !bucket.hasMore ? <span className="text-xs">Beginning of conversation</span> : null}</div>, Footer: () => <div className="h-3" /> }}
        itemContent={(index, m) => (
          <Bubble message={m} prev={items[index - first - 1]} chat={chat} meId={meId} onLightbox={setLightbox} onViewer={setViewer} />
        )}
      />
      {lightbox && <Lightbox item={lightbox} onClose={closeLightbox} />}
      {viewerMsg && <ViewOnceViewer message={viewerMsg} onClose={closeViewer} />}
    </>
  );
}
