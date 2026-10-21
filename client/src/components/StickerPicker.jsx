import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { STICKER_PACKS } from "../lib/stickers.js";
import { Sticker } from "./Media.jsx";

export default function StickerPicker({ onPick, onUpload }) {
  const [packId, setPackId] = useState(STICKER_PACKS[0].id);
  const fileRef = useRef(null);
  const pack = STICKER_PACKS.find((p) => p.id === packId);
  return (
    <div className="pop w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
      <div className="scroll-thin flex items-center gap-1 overflow-x-auto border-b border-line p-2">
        {STICKER_PACKS.map((p) => (
          <button key={p.id} onClick={() => setPackId(p.id)} className={`rounded-xl px-3 py-1.5 text-sm font-medium whitespace-nowrap ${p.id === packId ? "bg-accent text-accent-ink" : "text-muted hover:bg-surface-2"}`}>{p.icon} {p.name}</button>
        ))}
        <button onClick={() => fileRef.current?.click()} className="ml-auto flex items-center gap-1 rounded-xl px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted hover:bg-surface-2"><Plus size={14} /> Your own</button>
        <input ref={fileRef} type="file" accept="image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
      </div>
      <div className="scroll-thin grid max-h-72 grid-cols-3 gap-2 overflow-y-auto p-3">
        {pack.stickers.map((s) => (
          <button key={s.id} onClick={() => onPick(pack.id, s.id)} className="grid place-items-center rounded-xl p-2 transition hover:scale-105 hover:bg-surface-2 active:scale-95" aria-label={`Send sticker ${s.label}`}>
            <Sticker pack={pack.id} id={s.id} size={84} />
          </button>
        ))}
      </div>
      <p className="border-t border-line px-3 py-2 text-[11px] text-muted">“Your own” takes a PNG or WebP (transparent works best, up to 1 MB).</p>
    </div>
  );
}
