import { useEffect, useRef } from "react";
import { X, Loader2 } from "lucide-react";
import { initials, colorFor } from "../lib/format.js";
import { useToasts } from "../store/toast.js";

export function Avatar({ user, size = 40, online = false, className = "" }) {
  const style = { width: size, height: size, fontSize: size * 0.38 };
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size }}>
      {user?.avatar ? (
        <img src={user.avatar} alt="" loading="lazy" decoding="async" className="rounded-full object-cover" style={style} draggable={false} />
      ) : (
        <span className="grid place-items-center rounded-full font-semibold text-white select-none" style={{ ...style, background: colorFor(user?._id || user?.name) }}>
          {initials(user?.name)}
        </span>
      )}
      {online && <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface bg-emerald-500" aria-label="online" />}
    </span>
  );
}

export function IconButton({ label, children, className = "", ...rest }) {
  return (
    <button type="button" aria-label={label} title={label} className={`grid size-10 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-ink active:scale-95 disabled:opacity-40 ${className}`} {...rest}>
      {children}
    </button>
  );
}

export const Spinner = ({ size = 18, className = "" }) => <Loader2 size={size} className={`animate-spin ${className}`} aria-label="Loading" />;

export function Button({ variant = "primary", loading, children, className = "", ...rest }) {
  const styles = {
    primary: "bg-accent text-accent-ink hover:brightness-110",
    ghost: "bg-surface-2 text-ink hover:brightness-95",
    danger: "bg-danger text-white hover:brightness-110",
  }[variant];
  return (
    <button className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[.98] disabled:opacity-50 ${styles} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading && <Spinner size={16} />}
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector("input,textarea,button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/50 backdrop-blur-sm sm:place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`pop flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface shadow-2xl sm:rounded-3xl ${wide ? "sm:max-w-lg" : "sm:max-w-md"}`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose} className="-mr-2"><X size={20} /></IconButton>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-3" role="status" aria-live="polite">
      {items.map((t) => (
        <button key={t.id} onClick={() => dismiss(t.id)} className={`pop pointer-events-auto max-w-md rounded-xl px-4 py-2.5 text-left text-sm font-medium text-white shadow-lg ${t.type === "error" ? "bg-red-600" : t.type === "success" ? "bg-emerald-600" : "bg-slate-700"}`}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

export const TypingDots = () => (
  <span className="inline-flex items-center gap-1" aria-label="typing">
    {[0, 1, 2].map((i) => <span key={i} className="dot size-1.5 rounded-full bg-current" style={{ animationDelay: `${i * 0.15}s` }} />)}
  </span>
);
