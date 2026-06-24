/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * SPA entrypoint. App shell, routing, auth gating and the live-state provider
 * are defined here.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted fonts (offline-safe): Inter for UI, JetBrains Mono for data.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { App } from "@/App";
import "@/index.css";

const el = document.getElementById("root");
if (!el) throw new Error("Argus: #root element not found");

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
