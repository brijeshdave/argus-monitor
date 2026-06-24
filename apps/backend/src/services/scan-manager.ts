/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Managed background folder scans for server-side (SMB) storage monitors. A scan is
 * the expensive recursive folder walk; this module runs it with live progress and
 * cooperative pause / resume / cancel, caches the result per monitor, and applies it
 * through the normal pipeline (events/uptime + live patch + storage_metrics). Both
 * the periodic scheduler and the manual "Scan now" API drive scans through here, so
 * there is at most one scan per monitor at a time. In-process (no Redis), alongside
 * the other server-side schedulers.
 */
import type { FastifyInstance } from "fastify";
import { folderMetrics, logs, storageMetrics } from "@argus/db";
import type { FolderNode, MonitorDTO, StorageSample } from "@argus/shared";
import type { TelemetryDb } from "@argus/db";
import { getMonitor } from "@/services/monitors.js";
import { getMonitorCred } from "@/services/monitor-cred.js";
import { processUnits } from "@/services/pipeline.js";
import { smbProbe, ScanCancelled, type ScanProgress, type SmbWatch } from "@/services/smb.js";

const DEGRADED_PCT = 90;

export type ScanStatus = "idle" | "running" | "paused" | "done" | "cancelled" | "error";

export interface ScanState {
  status: ScanStatus;
  progress?: ScanProgress;
  startedAt?: string;
  finishedAt?: string;
  error?: string | null;
  /** When the cached folder result was last produced (ISO), for "last scanned" UI. */
  cachedAt?: string;
}

interface Entry {
  state: ScanState;
  paused: boolean;
  cancelled: boolean;
  resumeWaiters: Array<() => void>;
  cachedAt?: number;
  folders?: FolderNode[];
  cacheError?: string | null;
  running?: Promise<void>;
}

const reg = new Map<string, Entry>();

function entry(id: string): Entry {
  let e = reg.get(id);
  if (!e) { e = { state: { status: "idle" }, paused: false, cancelled: false, resumeWaiters: [] }; reg.set(id, e); }
  return e;
}

export function scanState(id: string): ScanState {
  return entry(id).state;
}

/** Update scan state from an agent's streamed progress (agent-collected monitors). */
export function setAgentScanState(app: FastifyInstance, monitorId: string, p: { status: string; folders: number; files: number; bytes: number; current: string }): void {
  const e = entry(monitorId);
  const prev = e.state.status;
  const terminal = p.status !== "running";
  e.state = {
    status: p.status as ScanStatus,
    progress: { folders: p.folders, files: p.files, bytes: p.bytes, current: p.current },
    startedAt: p.status === "running" && prev !== "running" ? new Date().toISOString() : e.state.startedAt,
    finishedAt: terminal ? new Date().toISOString() : undefined,
  };

  // Log scan lifecycle to the operator-visible logs on a transition (start / finish),
  // resolving the monitor name + its agent for the source. Fire-and-forget.
  const started = p.status === "running" && prev !== "running";
  const finished = terminal && prev === "running";
  if (started || finished) {
    void (async () => {
      const m = await getMonitor(app.master, monitorId);
      const agentId = m?.agentId ?? "";
      const name = m?.name ?? monitorId;
      if (started) {
        await logScan(app, agentId, "info", `Folder scan started: ${name}`, { monitorId });
      } else {
        const level = p.status === "done" ? "info" : p.status === "cancelled" ? "warn" : "error";
        const msg = p.status === "done"
          ? `Folder scan complete: ${name} — ${p.folders} folders · ${p.files} files · ${fmtBytes(p.bytes)}`
          : `Folder scan ${p.status}: ${name}`;
        await logScan(app, agentId, level, msg, { monitorId, folders: p.folders, files: p.files, bytes: p.bytes });
      }
    })();
  }
}

/** Cached folders for a monitor if still within ttl, else null (caller should rescan). */
export function cachedFolders(id: string, ttlMs: number): { folders?: FolderNode[]; error?: string | null } | null {
  const e = reg.get(id);
  if (!e || e.cachedAt === undefined) return null;
  if (Date.now() - e.cachedAt > ttlMs) return null;
  return { folders: e.folders, error: e.cacheError };
}

export function pauseScan(id: string): ScanState { const e = entry(id); if (e.running) e.paused = true; return e.state; }
export function resumeScan(id: string): ScanState {
  const e = entry(id);
  e.paused = false;
  for (const r of e.resumeWaiters.splice(0)) r();
  return e.state;
}
export function cancelScan(id: string): ScanState {
  const e = entry(id);
  if (e.running) { e.cancelled = true; e.paused = false; for (const r of e.resumeWaiters.splice(0)) r(); }
  return e.state;
}

export function parseWatch(raw: unknown): SmbWatch[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((w) => (typeof w === "string" ? { path: w, depth: 1 } : (w as { path?: unknown; depth?: unknown })))
    .map((w) => ({ sub: String((w as { path?: unknown }).path ?? "").trim(), depth: Number((w as { depth?: unknown }).depth) || 1 }))
    .filter((w) => w.sub);
}

function statusFor(s: StorageSample): "UP" | "DEGRADED" | "DOWN" {
  return !s.reachable ? "DOWN" : (s.usedPct ?? 0) >= DEGRADED_PCT ? "DEGRADED" : "UP";
}

/** Apply a storage sample through the pipeline + live patch + a metrics row. */
export async function applyStorageSample(app: FastifyInstance, m: { id: string; agentId: string; name: string }, storage: StorageSample): Promise<void> {
  const status = statusFor(storage);
  await processUnits(app.telemetry, m.agentId, [{ entity: m.name, status, meta: { storage } }]);
  if (storage.reachable) {
    await app.telemetry.insert(storageMetrics).values({
      storageId: m.id,
      usedPct: storage.usedPct ?? null,
      usedBytes: storage.usedBytes ?? null,
      totalBytes: storage.totalBytes ?? null,
    });
  }
  app.operatorHub.broadcast({
    t: "patch",
    agentId: m.agentId,
    units: [{ sourceId: m.agentId, entity: m.name, status, pid: null, meta: { storage } }],
    ts: new Date().toISOString(),
  });
}

// Per-folder history is throttled: the agent re-sends cached folders every tick, so
// without this we'd write thousands of identical rows per minute.
const FOLDER_HISTORY_MIN = Number(process.env.FOLDER_HISTORY_MIN ?? 60);
const lastFolderRecord = new Map<string, number>();

/** Snapshot each folder's size + counts into folder_metrics (throttled per monitor). */
export async function recordFolderMetrics(telemetry: TelemetryDb, storageId: string, folders: FolderNode[] | undefined): Promise<void> {
  if (!folders?.length) return;
  const last = lastFolderRecord.get(storageId) ?? 0;
  if (Date.now() - last < FOLDER_HISTORY_MIN * 60_000) return;
  lastFolderRecord.set(storageId, Date.now());
  await telemetry.insert(folderMetrics).values(
    folders.map((f) => ({ storageId, folder: f.name, sizeBytes: f.sizeBytes, fileCount: f.fileCount, folderCount: f.folderCount ?? null })),
  );
}

/** Compact byte formatter for log messages (MB/GB). */
function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Write a folder-scan lifecycle line into the operator-visible logs (category
 * "scan", keyed to the storage monitor's agent so it shows in the Logs viewer
 * filtered by source). Best-effort — a logging failure never breaks a scan.
 */
export async function logScan(
  app: FastifyInstance,
  agentId: string,
  level: "info" | "warn" | "error",
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    await app.telemetry.insert(logs).values({ sourceId: agentId, category: "scan", level, message, context: context ?? null });
  } catch (err) {
    app.log.warn({ err }, "scan log write failed");
  }
}

async function credPass(app: FastifyInstance, m: MonitorDTO): Promise<string> {
  const cfg = m.config as Record<string, unknown>;
  const encKey = process.env.ENCRYPTION_KEY;
  return (encKey ? await getMonitorCred(app.master, m.id, encKey) : null) ?? (typeof cfg.password === "string" ? cfg.password : "");
}

/**
 * Run (or join) a folder scan for a monitor. Resolves when the scan finishes; the
 * result is cached + applied. Concurrent calls share the in-flight run.
 */
export function runScan(app: FastifyInstance, monitorId: string): Promise<void> {
  const e = entry(monitorId);
  if (e.running) return e.running;
  e.cancelled = false;
  e.paused = false;
  e.state = { ...e.state, status: "running", startedAt: new Date().toISOString(), finishedAt: undefined, error: null, progress: { folders: 0, files: 0, bytes: 0, current: "" } };

  // Captured for lifecycle logging across all exit branches (catch/finally).
  let logAgentId = "";
  let logName = monitorId;

  e.running = (async () => {
    try {
      const m = await getMonitor(app.master, monitorId);
      if (!m || m.type !== "storage") throw new Error("not a storage monitor");
      logAgentId = m.agentId;
      logName = m.name;
      const cfg = m.config as Record<string, unknown>;
      const path = typeof cfg.path === "string" ? cfg.path : "";
      if (!path) throw new Error("monitor has no path");
      void logScan(app, m.agentId, "info", `Folder scan started: ${m.name}`, { monitorId, path });
      const storage = await smbProbe(path, typeof cfg.user === "string" ? cfg.user : "", await credPass(app, m), {
        folders: cfg.folders === true,
        watch: parseWatch(cfg.watchFolders),
        control: {
          isCancelled: () => e.cancelled,
          waitIfPaused: async () => {
            if (!e.paused) return;
            e.state.status = "paused";
            await new Promise<void>((r) => e.resumeWaiters.push(r));
            if (!e.cancelled) e.state.status = "running";
          },
          onProgress: (p) => { e.state.progress = p; },
        },
      });
      if (storage.reachable) { e.cachedAt = Date.now(); e.folders = storage.folders; e.cacheError = storage.error ?? null; e.state.cachedAt = new Date().toISOString(); }
      await applyStorageSample(app, m, storage);
      if (storage.reachable) await recordFolderMetrics(app.telemetry, m.id, storage.folders);
      e.state.status = "done";
      e.state.error = storage.error ?? null;
      const p = e.state.progress ?? { folders: storage.folders?.length ?? 0, files: 0, bytes: 0 };
      void logScan(app, m.agentId, storage.reachable ? "info" : "warn",
        `Folder scan complete: ${m.name} — ${p.folders} folders · ${p.files} files · ${fmtBytes(p.bytes)}${storage.error ? ` (${storage.error})` : ""}`,
        { monitorId, folders: p.folders, files: p.files, bytes: p.bytes, reachable: storage.reachable });
    } catch (err) {
      if (err instanceof ScanCancelled) {
        e.state.status = "cancelled";
        void logScan(app, logAgentId, "warn", `Folder scan cancelled: ${logName}`, { monitorId });
      } else {
        e.state.status = "error";
        e.state.error = (err as Error).message;
        app.log.warn({ err, monitorId }, "folder scan failed");
        void logScan(app, logAgentId, "error", `Folder scan failed: ${logName} — ${(err as Error).message}`, { monitorId });
      }
    } finally {
      e.state.finishedAt = new Date().toISOString();
      e.running = undefined;
    }
  })();
  return e.running;
}
