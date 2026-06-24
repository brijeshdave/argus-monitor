/**
 * Argus — Monitoring Platform · Author: Brijesh Dave <https://github.com/brijeshdave>
 * Vite config. Dev server proxies API + WS to the backend so the SPA and API
 * share an origin in development (mirrors the reverse-proxy setup in production).
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const BACKEND = process.env.BACKEND_ORIGIN ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: Number(process.env.FRONTEND_PORT ?? 8081),
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
      "/ws": { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
