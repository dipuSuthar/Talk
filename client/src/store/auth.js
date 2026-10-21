import { create } from "zustand";
import { api, setToken, refreshSession, errMsg } from "../lib/api.js";
import { disconnectSocket } from "../lib/socket.js";

export const useAuth = create((set) => ({
  user: null,
  status: "loading", // loading | in | out

  // On page load: try to resume the session from the httpOnly refresh cookie.
  async init() {
    try {
      const { user } = await refreshSession();
      set({ user, status: "in" });
    } catch {
      set({ user: null, status: "out" });
    }
  },

  async login(email, password) {
    const { data } = await api.post("/auth/login", { email, password });
    setToken(data.accessToken);
    set({ user: data.user, status: "in" });
  },

  async register(name, email, password) {
    const { data } = await api.post("/auth/register", { name, email, password });
    setToken(data.accessToken);
    set({ user: data.user, status: "in" });
  },

  async logout() {
    try {
      await api.post("/auth/logout");
    } catch (e) {
      console.warn("logout:", errMsg(e));
    }
    setToken(null);
    disconnectSocket();
    set({ user: null, status: "out" });
  },

  setUser: (user) => set({ user }),

  // ---- blocking ----
  blocked: {}, // userId -> true
  async loadBlocked() {
    try {
      const { data } = await api.get("/users/me/blocked");
      set({ blocked: Object.fromEntries(data.map((u) => [u._id, true])) });
    } catch {
      /* non-critical */
    }
  },
  async block(id) {
    await api.post(`/users/${id}/block`);
    set((s) => ({ blocked: { ...s.blocked, [id]: true } }));
  },
  async unblock(id) {
    await api.delete(`/users/${id}/block`);
    set((s) => {
      const b = { ...s.blocked };
      delete b[id];
      return { blocked: b };
    });
  },
  signedOut() {
    disconnectSocket();
    set({ user: null, status: "out" });
  },
}));
