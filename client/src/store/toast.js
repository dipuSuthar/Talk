import { create } from "zustand";

let n = 0;
export const useToasts = create((set) => ({
  items: [],
  push(type, text) {
    const id = ++n;
    set((s) => ({ items: [...s.items.slice(-3), { id, type, text }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 4500);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export const toast = {
  error: (t) => useToasts.getState().push("error", t),
  success: (t) => useToasts.getState().push("success", t),
  info: (t) => useToasts.getState().push("info", t),
};
