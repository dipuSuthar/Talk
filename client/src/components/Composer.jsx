import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Send, Paperclip, Smile, Sticker as StickerIcon, X, Eye, Infinity as Unlimited, Film } from "lucide-react";
import { useChat } from "../store/chat.js";
import { toast } from "../store/toast.js";
import { IconButton } from "./ui.jsx";
import StickerPicker from "./StickerPicker.jsx";
import { fileSize } from "../lib/format.js";

const EmojiPicker = lazy(() => import("emoji-picker-react")); // ~250KB, only loaded when opened
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";
const LIMITS = { image: 10, gif: 15, video: 50 };
const typeOf = (f) => (f.type.startsWith("video/") ? "video" : f.type === "image/gif" ? "gif" : "image");

const POLICIES = [
  { id: "unlimited", label: "Normal", icon: Unlimited, hint: "Stays in the chat" },
  { id: "once", label: "View once", icon: Eye, hint: "Disappears after 1 view" },
  { id: "twice", label: "View twice", icon: Eye, hint: "Disappears after 2 views" },
];

export default function Composer({ chatId, disabledReason }) {
  const sendText = useChat((s) => s.sendText);
  const sendSticker = useChat((s) => s.sendSticker);
  const sendMedia = useChat((s) => s.sendMedia);
  const setTyping = useChat((s) => s.setTyping);

  const [text, setText] = useState("");
  const [panel, setPanel] = useState(null); // 'emoji' | 'sticker'
  const [attach, setAttach] = useState(null); // { file, url, policy }
  const areaRef = useRef(null);
  const fileRef = useRef(null);
  const typingRef = useRef({ on: false, timer: null });
  const wrapRef = useRef(null);

  // ChatWindow is keyed by chat, so this component remounts per chat: only free the preview URL on unmount.
  const attachRef = useRef(null);
  useEffect(() => {
    attachRef.current = attach;
  }, [attach]);
  useEffect(() => () => attachRef.current && URL.revokeObjectURL(attachRef.current.url), []);

  // autosize textarea
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  // close panels on outside click
  useEffect(() => {
    if (!panel) return;
    const h = (e) => !wrapRef.current?.contains(e.target) && setPanel(null);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [panel]);

  const stopTyping = useCallback(() => {
    clearTimeout(typingRef.current.timer);
    if (typingRef.current.on) setTyping(chatId, false);
    typingRef.current.on = false;
  }, [chatId, setTyping]);
  useEffect(() => stopTyping, [stopTyping]);

  function onChange(e) {
    setText(e.target.value);
    if (!typingRef.current.on) {
      typingRef.current.on = true;
      setTyping(chatId, true);
    }
    clearTimeout(typingRef.current.timer);
    typingRef.current.timer = setTimeout(stopTyping, 2500);
  }

  const pickFile = useCallback((file, kind) => {
    if (!file) return;
    if (kind === "sticker") {
      if (!/^image\/(png|webp)$/.test(file.type)) return toast.error("Stickers must be PNG or WebP");
      if (file.size > 1024 * 1024) return toast.error("Sticker is too large (max 1 MB)");
      return sendMedia(chatId, file, { kind: "sticker" });
    }
    if (!ACCEPT.split(",").includes(file.type)) return toast.error("Use a JPG, PNG, WebP, GIF, MP4, WebM or MOV file");
    const t = typeOf(file);
    if (file.size > LIMITS[t] * 1024 * 1024) return toast.error(`${t === "gif" ? "GIFs" : t === "video" ? "Videos" : "Images"} can be up to ${LIMITS[t]} MB`);
    setAttach((a) => (a && URL.revokeObjectURL(a.url), { file, url: URL.createObjectURL(file), policy: "unlimited" }));
    setPanel(null);
    areaRef.current?.focus();
  }, [chatId, sendMedia]);

  // paste & drag-drop
  useEffect(() => {
    const onPaste = (e) => { const f = e.clipboardData?.files?.[0]; if (f) { e.preventDefault(); pickFile(f); } };
    const onDrop = (e) => { const f = e.dataTransfer?.files?.[0]; if (f) { e.preventDefault(); pickFile(f); } };
    const onOver = (e) => e.dataTransfer?.types?.includes("Files") && e.preventDefault();
    window.addEventListener("paste", onPaste);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onOver);
    return () => { window.removeEventListener("paste", onPaste); window.removeEventListener("drop", onDrop); window.removeEventListener("dragover", onOver); };
  }, [pickFile]);

  function submit() {
    stopTyping();
    if (attach) {
      sendMedia(chatId, attach.file, { viewPolicy: attach.policy, text: text.trim() });
      URL.revokeObjectURL(attach.url); // optimistic bubble keeps its own object URL
      setAttach(null);
      setText("");
      return;
    }
    const t = text.trim();
    if (!t) return;
    sendText(chatId, t);
    setText("");
  }

  if (disabledReason) return <div className="border-t border-line bg-surface px-4 py-4 text-center text-sm text-muted safe-b">{disabledReason}</div>;

  const canSend = Boolean(text.trim() || attach);
  return (
    <div ref={wrapRef} className="relative border-t border-line bg-surface safe-b">
      {panel && (
        <div className="absolute bottom-full left-2 z-20 mb-2">
          {panel === "emoji" ? (
            <Suspense fallback={<div className="rounded-2xl bg-surface p-6 text-sm text-muted shadow-xl">Loading…</div>}>
              <EmojiPicker emojiStyle="native" onEmojiClick={(e) => setText((t) => t + e.emoji)} lazyLoadEmojis theme={document.documentElement.dataset.theme === "dark" ? "dark" : "light"} width={Math.min(340, window.innerWidth - 24)} height={380} previewConfig={{ showPreview: false }} />
            </Suspense>
          ) : (
            <StickerPicker onPick={(pack, id) => { sendSticker(chatId, pack, id); setPanel(null); }} onUpload={(f) => { pickFile(f, "sticker"); setPanel(null); }} />
          )}
        </div>
      )}

      {attach && (
        <div className="pop mx-3 mt-3 flex gap-3 rounded-2xl border border-line bg-surface-2 p-3">
          <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-black">
            {typeOf(attach.file) === "video" ? <video src={attach.url} muted className="size-full object-cover" /> : <img src={attach.url} alt="" className={`size-full object-cover ${attach.policy !== "unlimited" ? "blur-sm" : ""}`} />}
            {typeOf(attach.file) === "video" && <Film size={16} className="absolute right-1 bottom-1 text-white" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-semibold">{attach.file.name}</p>
              <button aria-label="Remove attachment" className="text-muted hover:text-ink" onClick={() => { URL.revokeObjectURL(attach.url); setAttach(null); }}><X size={16} /></button>
            </div>
            <p className="text-xs text-muted">{fileSize(attach.file.size)} · {typeOf(attach.file).toUpperCase()}</p>
            <div className="mt-2 inline-flex rounded-xl bg-surface p-0.5" role="radiogroup" aria-label="Who can see it, and how long">
              {POLICIES.map((p) => (
                <button key={p.id} role="radio" aria-checked={attach.policy === p.id} title={p.hint} onClick={() => setAttach((a) => ({ ...a, policy: p.id }))} className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${attach.policy === p.id ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}>
                  <p.icon size={12} />{p.label}
                </button>
              ))}
            </div>
            {attach.policy !== "unlimited" && <p className="mt-1 text-[11px] text-muted">{POLICIES.find((p) => p.id === attach.policy).hint}. Recipients can’t save it from the chat.</p>}
          </div>
        </div>
      )}

      <div className="flex items-end gap-1 p-2 sm:p-3">
        <IconButton label="Emoji" onClick={() => setPanel(panel === "emoji" ? null : "emoji")} aria-expanded={panel === "emoji"}><Smile size={22} /></IconButton>
        <IconButton label="Stickers" onClick={() => setPanel(panel === "sticker" ? null : "sticker")} aria-expanded={panel === "sticker"}><StickerIcon size={22} /></IconButton>
        <IconButton label="Attach photo, GIF or video" onClick={() => fileRef.current?.click()}><Paperclip size={22} /></IconButton>
        <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />

        <textarea
          ref={areaRef}
          value={text}
          onChange={onChange}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          placeholder={attach ? "Add a caption…" : "Message"}
          rows={1}
          maxLength={attach ? 1000 : 4000}
          aria-label="Message"
          className="max-h-36 min-h-10 flex-1 resize-none rounded-2xl border border-line bg-surface-2 px-4 py-2.5 text-[15px] outline-none focus:border-accent"
        />
        <button onClick={submit} disabled={!canSend} aria-label="Send" className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition hover:brightness-110 active:scale-95 disabled:opacity-40"><Send size={18} /></button>
      </div>
    </div>
  );
}
