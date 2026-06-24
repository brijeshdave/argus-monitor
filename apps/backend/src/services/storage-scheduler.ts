/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Server-side storage scheduler. Each tick reads only the cheap bits (reachability +
 * capacity) for every enabled server-side storage monitor and applies them through
 * the pipeline (events/uptime + live patch + a storage_metrics row). The expensive
 * recursive folder walk is delegated to the scan-manager: cached folders are merged
 * in, and a fresh background scan is triggered when the cache goes stale (the
 * periodic auto-scan). Manual "Scan now" drives the same scan-manager.
 */
import type { FastifyInstance } from "fastify";
import { listEnabledServerStorageMonitors } from "@/services/monitors.js";
import { getMonitorCred } from "@/services/monitor-cred.js";
import { smbProbe } from "@/services/smb.js";
import { applyStorageSample, cachedFolders, runScan, scanState } from "@/services/scan-manager.js";

const INTERVAL_MS = Number(process.env.STORAGE_INTERVAL_MS ?? 300_000); // 5 min default
const DEFAULT_FOLDER_TTL_MIN = 15;

/** Folder-walk TTL = the smallest per-folder refresh period configured (or 15 min). */
function folderTtlMs(raw: unknown): number {
  const mins = Array.isArray(raw)
    ? raw.map((w) => Number((w as { refreshMin?: unknown })?.refreshMin)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  return (mins.length ? Math.min(...mins) : DEFAULT_FOLDER_TTL_MIN) * 60_000;
}

async function probe(app: FastifyInstance, m: { id: string; agentId: string; name: string; config: Record<string, unknown> }): Promise<void> {
  const path = typeof m.config.path === "string" ? m.config.path : "";
  if (!path) return;
  const user = typeof m.config.user === "string" ? m.config.user : "";
  const encKey = process.env.ENCRYPTION_KEY;
  const pass = (encKey ? await getMonitorCred(app.master, m.id, encKey) : null) ?? (typeof m.config.password === "string" ? m.config.password : "");

  const wantFolders = m.config.folders === true || (Array.isArray(m.config.watchFolders) && m.config.watchFolders.length > 0);
  // Cheap tick: capacity + reachability only.
  const storage = await smbProbe(path, user, pass, {});
  if (wantFolders && storage.reachable) {
    const cached = cachedFolders(m.id, folderTtlMs(m.config.watchFolders));
    if (cached) { storage.folders = cached.folders; storage.error = cached.error; }
    else if (scanState(m.id).status !== "running" && scanState(m.id).status !== "paused") {
      void runScan(app, m.id); // stale → kick off a background folder scan (periodic auto)
    }
  }
  await applyStorageSample(app, m, storage);
}

async function sweep(app: FastifyInstance): Promise<void> {
  const monitors = await listEnabledServerStorageMonitors(app.master);
  // Sequential: each probe spawns smbclient processes; don't stampede the host/NAS.
  for (const m of monitors) {
    await probe(app, { id: m.id, agentId: m.agentId, name: m.name, config: (m.config ?? {}) as Record<string, unknown> });
  }
}

/** Start the server-side storage scheduler; returns a stop fn + registers onClose. */
export function startStorageScheduler(app: FastifyInstance): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sweep(app);
    } catch (err) {
      app.log.error({ err }, "storage sweep failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref?.();
  void tick();
  const stop = () => clearInterval(timer);
  app.addHook("onClose", async () => stop());
  return stop;
}
