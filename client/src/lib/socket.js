import { io } from "socket.io-client";
import { getToken, refreshSession, setToken } from "./api.js";

let socket = null;

export function connectSocket(handlers) {
  if (socket) return socket;
  socket = io({
    path: "/socket.io",
    transports: ["websocket", "polling"],
    // function form => every (re)connect uses the freshest access token
    auth: (cb) => cb({ token: getToken() }),
    reconnectionDelayMax: 8000,
  });

  socket.on("connect_error", async (err) => {
    if (err.message === "unauthorized") {
      try {
        await refreshSession();
        socket.connect();
      } catch {
        setToken(null);
        window.dispatchEvent(new Event("talk:signed-out"));
      }
    }
  });

  for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn);
  return socket;
}

export const emit = (event, payload) => socket?.emit(event, payload);

export function disconnectSocket() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}
