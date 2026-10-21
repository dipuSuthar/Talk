const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
const shortDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export const formatTime = (d) => timeFmt.format(new Date(d));
export const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

export function dayLabel(d) {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return dayFmt.format(date);
}

export function listTime(d) {
  if (!d) return "";
  const date = new Date(d);
  if (sameDay(date, new Date())) return timeFmt.format(date);
  if (Date.now() - date.getTime() < 6 * 864e5) return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  return shortDay.format(date);
}

export function lastSeenLabel(d) {
  if (!d) return "offline";
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return "last seen just now";
  if (mins < 60) return `last seen ${mins} min ago`;
  if (sameDay(d, new Date())) return `last seen today at ${formatTime(d)}`;
  return `last seen ${dayLabel(d).toLowerCase()} at ${formatTime(d)}`;
}

export const initials = (name = "?") =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

export function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^\w-]/g, "");

const COLORS = ["#6366f1", "#0ea5e9", "#14b8a6", "#f59e0b", "#ec4899", "#8b5cf6", "#ef4444", "#22c55e"];
export const colorFor = (s = "") => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
