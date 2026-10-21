import { useEffect, useRef, useState } from "react";
import { X, Eye, EyeOff, Image as ImageIcon, Film, Flame, CircleDashed, AlertCircle } from "lucide-react";
import { findSticker } from "../lib/stickers.js";
import { api, errMsg } from "../lib/api.js";
import { useChat } from "../store/chat.js";
import { Spinner } from "./ui.jsx";

export function Sticker({ pack, id, size = 112 }) {
  const s = findSticker(pack, id);
  if (!s) return <span className="text-sm text-muted">[sticker]</span>;
  return (
    <span className="sticker relative inline-flex select-none flex-col items-center" style={{ width: size }} aria-label={s.label} role="img">
      <span style={{ fontSize: size * 0.62, lineHeight: 1 }}>{s.emoji}</span>
      <span className="-mt-1 rounded-full px-2 py-0.5 text-[11px] font-extrabold tracking-wide text-white uppercase" style={{ background: s.bg }}>{s.label}</span>
    </span>
  );
}

const frame = (m, fallback = 4 / 3) => {
  const ratio = m?.width && m?.height ? m.width / m.height : fallback;
  return { aspectRatio: String(ratio), width: `min(280px, 70vw, ${Math.round(340 * ratio)}px)` };
};

function Overlay({ children }) {
  return <div className="absolute inset-0 grid place-items-center bg-black/35 text-white">{children}</div>;
}

/** Inline media for unlimited (normal) photos, GIFs and videos. */
function OpenMedia({ message, onOpen }) {
  const { media, kind } = message;
  // `refreshed` remembers a replacement link, but only while it belongs to the link it replaced.
  const [refreshed, setRefreshed] = useState(null);
  const [failed, setFailed] = useState(false);
  const url = refreshed?.from === media.url ? refreshed.url : media.url;

  // Signed URLs are short-lived: if one expired, quietly ask for a fresh one.
  async function refresh() {
    try {
      const { data } = await api.post(`/messages/${message._id}/view`);
      setRefreshed({ from: media.url, url: data.url });
    } catch {
      setFailed(true);
    }
  }
  if (failed) return <Note icon={<AlertCircle size={16} />} text="Media unavailable" />;
  const bg = media.blur ? { backgroundImage: `url(${media.blur})`, backgroundSize: "cover" } : { background: "var(--surface-2)" };
  if (kind === "video") {
    return (
      <div className="overflow-hidden rounded-xl bg-black" style={frame(media, 16 / 9)}>
        <video src={url} controls preload="metadata" playsInline className="size-full object-contain" onError={refresh} />
      </div>
    );
  }
  return (
    <button type="button" className="block overflow-hidden rounded-xl" style={{ ...frame(media), ...bg }} onClick={() => onOpen({ url, kind })} aria-label="Open image">
      <img src={url} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" onError={refresh} />
      {kind === "gif" && <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 text-[10px] font-bold text-white">GIF</span>}
    </button>
  );
}

const Note = ({ icon, text }) => (
  <div className="flex items-center gap-2 rounded-xl border border-dashed border-current/30 px-3 py-2 text-sm opacity-80">{icon}{text}</div>
);

/** Instagram-style card for view-once / view-twice media. No bytes are loaded until the recipient taps it. */
function LimitedCard({ message, mine, onViewer }) {
  const { media, kind } = message;
  const label = kind === "video" ? "Video" : kind === "gif" ? "GIF" : "Photo";
  const Icon = kind === "video" ? Film : ImageIcon;
  const policyText = media.viewPolicy === "once" ? "View once" : "View twice";

  if (media.purged) return <Note icon={<CircleDashed size={16} />} text={`${label} expired`} />;

  if (mine) {
    const opened = media.openedBy?.length ?? 0;
    return (
      <div className="flex items-center gap-3 rounded-xl border border-current/25 px-3 py-2.5">
        <span className="grid size-9 place-items-center rounded-full border-2 border-dashed border-current/60"><Icon size={16} /></span>
        <div className="leading-tight">
          <div className="text-sm font-semibold">{label} · {policyText}</div>
          <div className="text-xs opacity-80">{message.status === "sending" ? "Sending…" : opened ? (opened > 1 ? `Opened by ${opened}` : "Opened") : "Delivered"}</div>
        </div>
      </div>
    );
  }

  const left = media.viewsLeft ?? 0;
  if (left <= 0) return <Note icon={<EyeOff size={16} />} text={`${label} opened`} />;
  return (
    <button type="button" onClick={() => onViewer(message)} className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-left text-ink transition hover:brightness-105 active:scale-[.98]">
      <span className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-orange-400 text-white shadow"><Flame size={18} /></span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold">Tap to view {label.toLowerCase()}</span>
        <span className="block text-xs text-muted">{policyText} · {left} view{left > 1 ? "s" : ""} left</span>
      </span>
    </button>
  );
}

/** A photo/video that's still uploading (optimistic). */
function Uploading({ message }) {
  const { localUrl, kind, progress = 0, media } = message;
  const limited = media?.viewPolicy && media.viewPolicy !== "unlimited";
  return (
    <div className="relative overflow-hidden rounded-xl bg-surface-2" style={{ width: "min(240px, 65vw)", aspectRatio: "4 / 3" }}>
      {kind === "video" ? <video src={localUrl} muted className="size-full object-cover" /> : <img src={localUrl} alt="" className={`size-full object-cover ${limited ? "blur-xl" : ""}`} />}
      <Overlay>
        {message.status === "failed" ? <AlertCircle /> : (
          <div className="flex flex-col items-center gap-1 text-xs font-semibold"><Spinner size={24} />{progress}%</div>
        )}
      </Overlay>
      {limited && <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">{media.viewPolicy === "once" ? "View once" : "View twice"}</span>}
    </div>
  );
}

export function MessageMedia({ message, mine, onLightbox, onViewer }) {
  if (message.sticker) return <Sticker pack={message.sticker.pack} id={message.sticker.id} />;
  if (message.localUrl && message.status) return <Uploading message={message} />;
  const m = message.media;
  if (!m) return null;

  if (m.legacy) {
    if (message.kind === "video") return <video src={m.url} controls preload="metadata" playsInline className="max-h-80 max-w-[min(280px,70vw)] rounded-xl bg-black" />;
    return <img src={m.url} alt="" loading="lazy" className="max-h-80 max-w-[min(280px,70vw)] rounded-xl object-cover" onClick={() => onLightbox({ url: m.url, kind: "image" })} />;
  }
  if (message.kind === "sticker") {
    if (m.purged) return <Note icon={<CircleDashed size={16} />} text="Sticker unavailable" />;
    return <img src={m.url} alt="Sticker" className="sticker size-32 object-contain" draggable={false} loading="lazy" />;
  }
  if (m.viewPolicy !== "unlimited") return <LimitedCard message={message} mine={mine} onViewer={onViewer} />;
  if (m.purged) return <Note icon={<CircleDashed size={16} />} text="Media deleted" />;
  return <OpenMedia message={message} onOpen={onLightbox} />;
}

/** Fullscreen viewer for normal photos/GIFs/videos. */
export function Lightbox({ item, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/90 p-4" onClick={onClose}>
      <button className="absolute top-4 right-4 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" onClick={onClose} aria-label="Close"><X /></button>
      {item.kind === "video" ? <video src={item.url} controls autoPlay playsInline className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} /> : <img src={item.url} alt="" className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />}
    </div>
  );
}

/**
 * Secure viewer for view-once / view-twice media.
 * Opening it asks the server for a short-lived link, which atomically consumes ONE view.
 * The UI also discourages saving (no context menu, no drag, no download control) and
 * hides the content whenever the tab loses focus. (Browsers can't block screenshots.)
 */
export function ViewOnceViewer({ message, onClose }) {
  const [state, setState] = useState({ status: "loading" });
  const [hidden, setHidden] = useState(false);

  // ONE request per viewer instance. A ref holds the promise so React StrictMode's double-invoked
  // effects (dev only) can't consume a second view.
  const request = useRef(null);
  useEffect(() => {
    let alive = true;
    request.current ??= api.post(`/messages/${message._id}/view`);
    request.current
      .then(({ data }) => {
        if (!alive) return;
        setState({ status: "ready", url: data.url, left: data.viewsLeft });
        // update the card locally right away; the server also pushes message:updated
        useChat.getState()._addOrReplace(message.chat, { ...message, media: { ...message.media, viewsLeft: data.viewsLeft, blur: data.viewsLeft > 0 ? message.media.blur : undefined } });
      })
      .catch((e) => alive && setState({ status: "error", error: errMsg(e, "Couldn't open this media") }));
    return () => {
      alive = false;
    };
  }, [message]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    const onVis = () => setHidden(document.visibilityState !== "visible");
    const onBlur = () => setHidden(true);
    const onFocus = () => setHidden(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [onClose]);

  const block = (e) => e.preventDefault();
  const isVideo = message.kind === "video";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black select-none" style={{ WebkitTouchCallout: "none" }} onContextMenu={block}>
      <div className="flex items-center justify-between px-4 py-3 text-white safe-t">
        <span className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
          <Eye size={14} />
          {state.status === "ready" ? (state.left > 0 ? `${state.left} view left after this` : "Last view — it disappears after this") : "Opening…"}
        </span>
        <button className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" onClick={onClose} aria-label="Close"><X /></button>
      </div>

      <div className="relative grid min-h-0 flex-1 place-items-center p-3">
        {state.status === "loading" && <Spinner size={32} className="text-white" />}
        {state.status === "error" && (
          <div className="flex max-w-xs flex-col items-center gap-3 text-center text-white">
            <EyeOff size={36} /><p>{state.error}</p>
            <button className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold" onClick={onClose}>Close</button>
          </div>
        )}
        {state.status === "ready" && (
          <>
            {isVideo ? (
              <video src={state.url} controls autoPlay playsInline controlsList="nodownload noplaybackrate" disablePictureInPicture disableRemotePlayback onContextMenu={block} className={`max-h-full max-w-full transition ${hidden ? "blur-3xl" : ""}`} />
            ) : (
              <img src={state.url} alt="" draggable={false} onContextMenu={block} onDragStart={block} className={`max-h-full max-w-full rounded-lg object-contain transition ${hidden ? "blur-3xl" : ""}`} />
            )}
            {!isVideo && <div className="absolute inset-0" onContextMenu={block} aria-hidden />}
            {hidden && <div className="absolute inset-0 grid place-items-center text-white/80"><EyeOff size={40} /></div>}
          </>
        )}
      </div>
      <p className="px-4 pb-4 text-center text-xs text-white/50 safe-b">Screenshots can’t be blocked by a web app — only share with people you trust.</p>
    </div>
  );
}
