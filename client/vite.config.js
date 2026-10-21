import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// In dev, proxy API + websockets to the Node server so the browser sees ONE origin
// (same as production behind nginx) - no CORS and the refresh cookie just works.
const target = process.env.VITE_API_TARGET || "http://localhost:7000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5174,
    proxy: {
      "/api": { target, changeOrigin: true },
      "/uploads": { target, changeOrigin: true },
      "/socket.io": { target, ws: true, changeOrigin: true },
    },
  },
  build: { sourcemap: false }, // the emoji picker is loaded with import() so it is its own lazy chunk
});
