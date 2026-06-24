/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Report service: generates on-demand reports (summary / uptime / incidents /
 * storage / inventory) over a rolling-days OR explicit custom date range, writes
 * each as a timestamped JSON snapshot under DATA_DIR/reports, and lists/reads/
 * deletes those files for the operator UI. Mirrors the backup service's disk +
 * path-traversal handling. Reports are derived read-models — the inventory report
 * is deliberately scrubbed of ids/secrets so it is safe to export.
 */
import { promises as fs } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  agents,
  folderMetrics,
  hostMetrics,
  monitors,
  processMetrics,
  statusEvents,
  storageMetrics,
  uptimeBuckets,
  type MasterDb,
  type TelemetryDb,
} from "@argus/db";
import { uptimePct } from "@argus/core";
import type { ReportMeta, ReportRequest, ReportType } from "@argus/shared";
import { REPORT_TYPES } from "@argus/shared";

/** Directory where report files live (under DATA_DIR; created on first write). */
export const REPORT_DIR = resolve(`${process.env.DATA_DIR ?? "./data"}/reports`);

const FILE_PREFIX = "argus-report-";
const DEFAULT_DAYS = 30;
const INCIDENT_STATUSES = ["DOWN", "HANG", "DEGRADED"] as const;
const INCIDENT_CAP = 2000;
const STORAGE_ALERT_PCT = 75; // shares at/above this are surfaced in the summary

/** Build the timestamped file name for a new report (":" is unsafe on Windows). */
function reportFileName(type: ReportType, generatedAt: string): string {
  return `${FILE_PREFIX}${type}-${generatedAt.replace(/:/g, "-")}.json`;
}

/** Recover the report type encoded in a file name (defaults to "uptime"). */
function typeFromName(name: string): ReportType {
  const rest = name.slice(FILE_PREFIX.length);
  const found = REPORT_TYPES.find((t) => rest.startsWith(`${t}-`));
  return found ?? "uptime";
}

/** Resolve a user-supplied name to an absolute path INSIDE REPORT_DIR (or throw). */
function safeReportPath(name: string): string {
  // Reject anything that isn't a bare *.json file name in the report directory.
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error("invalid report name");
  }
  const full = resolve(REPORT_DIR, name);
  if (full !== resolve(REPORT_DIR, basename(name)) || !full.startsWith(REPORT_DIR + sep)) {
    throw new Error("path traversal rejected");
  }
  return full;
}

// ---------------------------------------------------------------------------
// Time window — rolling days OR an explicit custom range.
// ---------------------------------------------------------------------------

interface Window {
  fromIso: string;
  untilIso: string;
  days: number;
  label: string;
}

/** Normalise a date-only ("YYYY-MM-DD") string to a start/end-of-day ISO stamp. */
function toStartIso(s: string): string {
  return s.length === 10 ? new Date(`${s}T00:00:00.000Z`).toISOString() : new Date(s).toISOString();
}
function toEndIso(s: string): string {
  return s.length === 10 ? new Date(`${s}T23:59:59.999Z`).toISOString() : new Date(s).toISOString();
}

/** Resolve the effective window: explicit range wins, else the rolling days window. */
function resolveWindow(req: ReportRequest): Window {
  if (req.from) {
    const fromIso = toStartIso(req.from);
    const untilIso = req.to ? toEndIso(req.to) : new Date().toISOString();
    const days = Math.max(1, Math.ceil((Date.parse(untilIso) - Date.parse(fromIso)) / 86_400_000));
    return { fromIso, untilIso, days, label: `${fromIso.slice(0, 10)} → ${untilIso.slice(0, 10)}` };
  }
  const days = req.days ?? DEFAULT_DAYS;
  const untilIso = new Date().toISOString();
  const fromIso = new Date(Date.now() - days * 86_400_000).toISOString();
  return { fromIso, untilIso, days, label: `Last ${days} day${days === 1 ? "" : "s"}` };
}

/** Friendly scope label resolved from the master DB (for the saved-report list). */
async function resolveScopeLabel(master: MasterDb, scope: ReportRequest["scope"]): Promise<string> {
  if (scope.kind === "agent" && scope.refId) {
    const [a] = await master.select().from(agents).where(eq(agents.id, scope.refId));
    return `Agent: ${a?.name ?? "unknown"}`;
  }
  if (scope.kind === "monitor" && scope.refId) {
    const [m] = await master.select().from(monitors).where(eq(monitors.id, scope.refId));
    return `Monitor: ${m?.name ?? "unknown"}`;
  }
  return "All monitors";
}

/** One (sourceId, entity, label) tuple a report is computed over. */
interface Target {
  sourceId: string;
  entity: string;
  label: string;
}

/**
 * Resolve the monitor targets a uptime/scoped report covers. Buckets/events key
 * on sourceId=agentId and entity=monitor.name (the diff pipeline's convention).
 */
async function resolveTargets(master: MasterDb, scope: ReportRequest["scope"]): Promise<Target[]> {
  let monitorRows: Array<typeof monitors.$inferSelect>;
  if (scope.kind === "monitor" && scope.refId) {
    monitorRows = await master.select().from(monitors).where(eq(monitors.id, scope.refId));
  } else if (scope.kind === "agent" && scope.refId) {
    monitorRows = await master.select().from(monitors).where(eq(monitors.agentId, scope.refId));
  } else {
    monitorRows = await master.select().from(monitors);
  }
  return monitorRows.map((m) => ({ sourceId: m.agentId, entity: m.name, label: m.name }));
}

// ---------------------------------------------------------------------------
// Data builders
// ---------------------------------------------------------------------------

interface UptimeData {
  rows: Array<{ label: string; uptimePct: number }>;
  overallPct: number;
  /** Overall daily availability trend (for a line chart). */
  trend: Array<{ date: string; upPct: number | null }>;
}

/** Per-monitor availability + an overall daily trend within the window. */
async function buildUptimeData(
  master: MasterDb,
  telemetry: TelemetryDb,
  scope: ReportRequest["scope"],
  win: Window,
): Promise<UptimeData> {
  const targets = await resolveTargets(master, scope);
  const rows: Array<{ label: string; uptimePct: number }> = [];
  const byDay = new Map<string, { up: number; total: number }>();
  let totUp = 0;
  let totTotal = 0;

  for (const t of targets) {
    const buckets = await telemetry
      .select({ bucketStart: uptimeBuckets.bucketStart, upSec: uptimeBuckets.upSec, totalSec: uptimeBuckets.totalSec })
      .from(uptimeBuckets)
      .where(
        and(
          eq(uptimeBuckets.sourceId, t.sourceId),
          eq(uptimeBuckets.entity, t.entity),
          gte(uptimeBuckets.bucketStart, win.fromIso),
          lte(uptimeBuckets.bucketStart, win.untilIso),
        ),
      );
    let up = 0;
    let total = 0;
    for (const b of buckets) {
      up += b.upSec;
      total += b.totalSec;
      const day = b.bucketStart.slice(0, 10);
      const a = byDay.get(day) ?? { up: 0, total: 0 };
      a.up += b.upSec;
      a.total += b.totalSec;
      byDay.set(day, a);
    }
    totUp += up;
    totTotal += total;
    rows.push({ label: t.label, uptimePct: uptimePct({ upSec: up, totalSec: total }) });
  }

  const trend = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, a]) => ({ date, upPct: a.total > 0 ? Math.round((a.up / a.total) * 10000) / 100 : null }));
  rows.sort((a, b) => a.uptimePct - b.uptimePct); // worst first — most useful at a glance

  return { rows, overallPct: uptimePct({ upSec: totUp, totalSec: totTotal }), trend };
}

interface IncidentData {
  count: number;
  items: Array<{ entity: string; newStatus: string | null; ts: string }>;
  /** Daily incident counts, split by status (for a stacked bar chart). */
  perDay: Array<{ date: string; total: number; DOWN: number; HANG: number; DEGRADED: number }>;
}

/** Status-change incidents (DOWN/HANG/DEGRADED) within the window, scope-filtered. */
async function buildIncidentData(
  master: MasterDb,
  telemetry: TelemetryDb,
  scope: ReportRequest["scope"],
  win: Window,
): Promise<IncidentData> {
  const clauses = [
    gte(statusEvents.ts, win.fromIso),
    lte(statusEvents.ts, win.untilIso),
    inArray(statusEvents.newStatus, [...INCIDENT_STATUSES]),
  ];

  if (scope.kind === "agent" && scope.refId) {
    clauses.push(eq(statusEvents.sourceId, scope.refId));
  } else if (scope.kind === "monitor" && scope.refId) {
    const [m] = await master.select().from(monitors).where(eq(monitors.id, scope.refId));
    if (!m) return { count: 0, items: [], perDay: [] };
    clauses.push(eq(statusEvents.sourceId, m.agentId), eq(statusEvents.entity, m.name));
  }

  const events = await telemetry
    .select({ entity: statusEvents.entity, newStatus: statusEvents.newStatus, ts: statusEvents.ts })
    .from(statusEvents)
    .where(and(...clauses))
    .orderBy(desc(statusEvents.ts))
    .limit(INCIDENT_CAP);

  const byDay = new Map<string, { total: number; DOWN: number; HANG: number; DEGRADED: number }>();
  for (const e of events) {
    const day = e.ts.slice(0, 10);
    const a = byDay.get(day) ?? { total: 0, DOWN: 0, HANG: 0, DEGRADED: 0 };
    a.total += 1;
    if (e.newStatus === "DOWN") a.DOWN += 1;
    else if (e.newStatus === "HANG") a.HANG += 1;
    else if (e.newStatus === "DEGRADED") a.DEGRADED += 1;
    byDay.set(day, a);
  }
  const perDay = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, a]) => ({ date, ...a }));

  return { count: events.length, items: events, perDay };
}

/**
 * Clean inventory snapshot. Deliberately excludes ids and any secret material —
 * only operator-meaningful labels — so the file is safe to share.
 */
async function buildInventoryData(master: MasterDb): Promise<{
  agents: Array<{ name: string; platform: string | null; status: string; version: string | null }>;
  monitors: Array<{ name: string; type: string; enabled: boolean; agentName: string }>;
}> {
  const [agentRows, monitorRows] = await Promise.all([
    master.select().from(agents),
    master.select().from(monitors),
  ]);
  const agentNameById = new Map(agentRows.map((a) => [a.id, a.name]));
  return {
    agents: agentRows.map((a) => ({ name: a.name, platform: a.platform, status: a.status, version: a.version })),
    monitors: monitorRows.map((m) => ({
      name: m.name,
      type: m.type,
      enabled: m.enabled,
      agentName: agentNameById.get(m.agentId) ?? "",
    })),
  };
}

interface StorageData {
  monitors: Array<{
    name: string;
    current: { usedPct: number | null; usedBytes: number | null; totalBytes: number | null };
    days: Array<{ date: string; usedPct: number | null; usedBytes: number | null; totalBytes: number | null }>;
  }>;
}

/**
 * Datewise storage report: per storage monitor, daily capacity (avg used %, last
 * used/total bytes) over the window. Safe to share — monitor names only, no paths.
 */
async function buildStorageData(
  master: MasterDb,
  telemetry: TelemetryDb,
  scope: ReportRequest["scope"],
  win: Window,
): Promise<StorageData> {
  let rows: Array<typeof monitors.$inferSelect>;
  if (scope.kind === "monitor" && scope.refId) rows = await master.select().from(monitors).where(eq(monitors.id, scope.refId));
  else if (scope.kind === "agent" && scope.refId) rows = await master.select().from(monitors).where(eq(monitors.agentId, scope.refId));
  else rows = await master.select().from(monitors);
  const storage = rows.filter((m) => m.type === "storage");

  const out: StorageData["monitors"] = [];
  for (const m of storage) {
    const points = await telemetry
      .select({ ts: storageMetrics.ts, usedPct: storageMetrics.usedPct, usedBytes: storageMetrics.usedBytes, totalBytes: storageMetrics.totalBytes })
      .from(storageMetrics)
      .where(and(eq(storageMetrics.storageId, m.id), gte(storageMetrics.ts, win.fromIso), lte(storageMetrics.ts, win.untilIso)))
      .orderBy(storageMetrics.ts);
    // Aggregate per calendar day: average used %, last-of-day bytes.
    const byDay = new Map<string, { sum: number; n: number; usedBytes: number | null; totalBytes: number | null }>();
    for (const p of points) {
      const date = p.ts.slice(0, 10);
      const a = byDay.get(date) ?? { sum: 0, n: 0, usedBytes: null, totalBytes: null };
      if (p.usedPct != null) { a.sum += p.usedPct; a.n += 1; }
      if (p.usedBytes != null) a.usedBytes = p.usedBytes;
      if (p.totalBytes != null) a.totalBytes = p.totalBytes;
      byDay.set(date, a);
    }
    const daysOut = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, a]) => ({ date, usedPct: a.n ? Math.round((a.sum / a.n) * 10) / 10 : null, usedBytes: a.usedBytes, totalBytes: a.totalBytes }));
    const last = points.at(-1);
    out.push({ name: m.name, current: { usedPct: last?.usedPct ?? null, usedBytes: last?.usedBytes ?? null, totalBytes: last?.totalBytes ?? null }, days: daysOut });
  }
  return { monitors: out };
}

interface StorageDetailData {
  monitors: Array<{
    name: string;
    current: { usedPct: number | null; usedBytes: number | null; totalBytes: number | null; freeBytes: number | null };
    days: Array<{ date: string; usedPct: number | null; usedBytes: number | null; totalBytes: number | null }>;
    topFolders: Array<{ folder: string; sizeBytes: number | null; fileCount: number | null; folderCount: number | null }>;
    capturedAt: string | null;
  }>;
}

const TOP_FOLDERS = 30;
const WALK_WINDOW_MS = 6 * 60 * 60 * 1000; // one folder-walk spans roughly this long

/** Resolve the storage monitor rows (with ids) in scope — shared by both storage reports. */
async function resolveStorageMonitors(master: MasterDb, scope: ReportRequest["scope"]): Promise<Array<typeof monitors.$inferSelect>> {
  let rows: Array<typeof monitors.$inferSelect>;
  if (scope.kind === "monitor" && scope.refId) rows = await master.select().from(monitors).where(eq(monitors.id, scope.refId));
  else if (scope.kind === "agent" && scope.refId) rows = await master.select().from(monitors).where(eq(monitors.agentId, scope.refId));
  else rows = await master.select().from(monitors);
  return rows.filter((m) => m.type === "storage");
}

/**
 * Detailed storage report: capacity + growth (as the capacity report) PLUS the
 * largest folders from the most recent folder-walk (size, file + sub-folder
 * counts) — the "what's eating the disk" view for capacity planning.
 */
async function buildStorageDetailData(
  master: MasterDb,
  telemetry: TelemetryDb,
  scope: ReportRequest["scope"],
  win: Window,
): Promise<StorageDetailData> {
  const base = await buildStorageData(master, telemetry, scope, win);
  const storage = await resolveStorageMonitors(master, scope);

  const out: StorageDetailData["monitors"] = [];
  for (const m of storage) {
    const baseMon = base.monitors.find((b) => b.name === m.name);
    const cur = baseMon?.current ?? { usedPct: null, usedBytes: null, totalBytes: null };
    const freeBytes = cur.totalBytes != null && cur.usedBytes != null ? cur.totalBytes - cur.usedBytes : null;

    // The most recent folder-walk for this share, then its largest folders.
    const [latest] = await telemetry
      .select({ ts: folderMetrics.ts })
      .from(folderMetrics)
      .where(eq(folderMetrics.storageId, m.id))
      .orderBy(desc(folderMetrics.ts))
      .limit(1);

    const topFolders: StorageDetailData["monitors"][number]["topFolders"] = [];
    if (latest) {
      const sinceWalk = new Date(Date.parse(latest.ts) - WALK_WINDOW_MS).toISOString();
      const rows = await telemetry
        .select({ folder: folderMetrics.folder, sizeBytes: folderMetrics.sizeBytes, fileCount: folderMetrics.fileCount, folderCount: folderMetrics.folderCount })
        .from(folderMetrics)
        .where(and(eq(folderMetrics.storageId, m.id), gte(folderMetrics.ts, sinceWalk)))
        .orderBy(desc(folderMetrics.sizeBytes))
        .limit(200);
      const seen = new Set<string>();
      for (const r of rows) {
        if (seen.has(r.folder)) continue;
        seen.add(r.folder);
        topFolders.push({ folder: r.folder, sizeBytes: r.sizeBytes, fileCount: r.fileCount, folderCount: r.folderCount });
        if (topFolders.length >= TOP_FOLDERS) break;
      }
    }

    out.push({
      name: m.name,
      current: { ...cur, freeBytes },
      days: baseMon?.days ?? [],
      topFolders,
      capturedAt: latest?.ts ?? null,
    });
  }
  return { monitors: out };
}

// ---------------------------------------------------------------------------
// Resource usage (CPU / RAM) — host trend + per-process drill-down.
// ---------------------------------------------------------------------------

const RESOURCE_SERIES_CAP = 25; // cap charted process series for legibility

type DayRow = Record<string, number | string | null>;

/** Average numeric series per calendar day (oldest→newest); missing → null. */
function dailyAvg(pts: Array<Record<string, number | null | string>>, keys: string[]): DayRow[] {
  const byDay = new Map<string, Record<string, { sum: number; n: number }>>();
  for (const p of pts) {
    const date = String(p.date);
    const acc = byDay.get(date) ?? {};
    for (const k of keys) {
      const v = p[k];
      if (typeof v === "number") {
        const a = acc[k] ?? { sum: 0, n: 0 };
        a.sum += v;
        a.n += 1;
        acc[k] = a;
      }
    }
    byDay.set(date, acc);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, acc]) => {
      const row: DayRow = { date };
      for (const k of keys) {
        const a = acc[k];
        row[k] = a ? Math.round((a.sum / a.n) * 10) / 10 : null;
      }
      return row;
    });
}

const avgOf = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const peakOf = (xs: number[]): number | null => (xs.length ? Math.round(Math.max(...xs) * 10) / 10 : null);

interface ResourceData {
  hosts: Array<{ name: string; points: Array<{ date: string; cpuPct: number | null; memPct: number | null }> }>;
  processes: Array<{ name: string; points: Array<{ date: string; cpuPct: number | null; memMb: number | null }> }>;
  rows: Array<{ name: string; kind: "host" | "process"; avgCpu: number | null; peakCpu: number | null; avgMem: number | null; memUnit: "%" | "MB" }>;
}

/** Host CPU/RAM trend per agent + per-process CPU/RAM, with an averages table. */
async function buildResourceData(
  master: MasterDb,
  telemetry: TelemetryDb,
  scope: ReportRequest["scope"],
  win: Window,
): Promise<ResourceData> {
  // Resolve the agent set, and an optional single-entity focus for monitor scope.
  let agentRows: Array<typeof agents.$inferSelect>;
  let onlyEntity: string | undefined;
  if (scope.kind === "agent" && scope.refId) {
    agentRows = await master.select().from(agents).where(eq(agents.id, scope.refId));
  } else if (scope.kind === "monitor" && scope.refId) {
    const [m] = await master.select().from(monitors).where(eq(monitors.id, scope.refId));
    if (!m) return { hosts: [], processes: [], rows: [] };
    agentRows = await master.select().from(agents).where(eq(agents.id, m.agentId));
    onlyEntity = m.name;
  } else {
    agentRows = await master.select().from(agents);
  }
  if (agentRows.length === 0) return { hosts: [], processes: [], rows: [] };

  const rows: ResourceData["rows"] = [];
  const hosts: ResourceData["hosts"] = [];

  // Host-level CPU/RAM (skipped when a single process/monitor is the focus).
  if (!onlyEntity) {
    for (const a of agentRows) {
      const pts = await telemetry
        .select({ ts: hostMetrics.ts, cpuPct: hostMetrics.cpuPct, memPct: hostMetrics.memPct })
        .from(hostMetrics)
        .where(and(eq(hostMetrics.agentId, a.id), gte(hostMetrics.ts, win.fromIso), lte(hostMetrics.ts, win.untilIso)))
        .orderBy(hostMetrics.ts);
      if (pts.length === 0) continue;
      const points = dailyAvg(pts.map((p) => ({ date: p.ts.slice(0, 10), cpuPct: p.cpuPct, memPct: p.memPct })), ["cpuPct", "memPct"]) as unknown as ResourceData["hosts"][number]["points"];
      hosts.push({ name: a.name, points });
      const cpu = pts.map((p) => p.cpuPct).filter((v): v is number => v != null);
      const mem = pts.map((p) => p.memPct).filter((v): v is number => v != null);
      rows.push({ name: a.name, kind: "host", avgCpu: avgOf(cpu), peakCpu: peakOf(cpu), avgMem: avgOf(mem), memUnit: "%" });
    }
  }

  // Per-process CPU/RAM.
  const agentIds = agentRows.map((a) => a.id);
  const procClauses = [gte(processMetrics.ts, win.fromIso), lte(processMetrics.ts, win.untilIso), inArray(processMetrics.sourceId, agentIds)];
  if (onlyEntity) procClauses.push(eq(processMetrics.entity, onlyEntity));
  const procRows = await telemetry
    .select({ entity: processMetrics.entity, ts: processMetrics.ts, cpuPct: processMetrics.cpuPct, memMb: processMetrics.memMb })
    .from(processMetrics)
    .where(and(...procClauses))
    .orderBy(processMetrics.ts);

  const byEntity = new Map<string, Array<{ date: string; cpuPct: number | null; memMb: number | null }>>();
  const rawByEntity = new Map<string, { cpu: number[]; mem: number[] }>();
  for (const r of procRows) {
    const arr = byEntity.get(r.entity) ?? [];
    arr.push({ date: r.ts.slice(0, 10), cpuPct: r.cpuPct, memMb: r.memMb });
    byEntity.set(r.entity, arr);
    const raw = rawByEntity.get(r.entity) ?? { cpu: [], mem: [] };
    if (r.cpuPct != null) raw.cpu.push(r.cpuPct);
    if (r.memMb != null) raw.mem.push(r.memMb);
    rawByEntity.set(r.entity, raw);
  }

  let processes = [...byEntity.entries()]
    .map(([name, pts]) => ({ name, points: dailyAvg(pts, ["cpuPct", "memMb"]) as unknown as ResourceData["processes"][number]["points"] }))
    .sort((a, b) => (peakOf(rawByEntity.get(b.name)?.cpu ?? []) ?? 0) - (peakOf(rawByEntity.get(a.name)?.cpu ?? []) ?? 0));

  for (const p of processes) {
    const raw = rawByEntity.get(p.name) ?? { cpu: [], mem: [] };
    rows.push({ name: p.name, kind: "process", avgCpu: avgOf(raw.cpu), peakCpu: peakOf(raw.cpu), avgMem: avgOf(raw.mem), memUnit: "MB" });
  }
  processes = processes.slice(0, RESOURCE_SERIES_CAP);

  return { hosts, processes, rows };
}

/** Executive summary: headline KPIs + the few charts that matter for management. */
async function buildSummaryData(
  master: MasterDb,
  telemetry: TelemetryDb,
  scope: ReportRequest["scope"],
  win: Window,
): Promise<{
  overallUptimePct: number;
  incidentCount: number;
  agentsTotal: number;
  monitorsTotal: number;
  monitorsEnabled: number;
  worstMonitors: Array<{ label: string; uptimePct: number }>;
  topIncidentMonitors: Array<{ entity: string; count: number }>;
  storageAlerts: Array<{ name: string; usedPct: number }>;
  uptimeTrend: Array<{ date: string; upPct: number | null }>;
  incidentsPerDay: IncidentData["perDay"];
}> {
  const [uptime, incidents, storage, inventory] = await Promise.all([
    buildUptimeData(master, telemetry, scope, win),
    buildIncidentData(master, telemetry, scope, win),
    buildStorageData(master, telemetry, scope, win),
    buildInventoryData(master),
  ]);

  const counts = new Map<string, number>();
  for (const it of incidents.items) counts.set(it.entity, (counts.get(it.entity) ?? 0) + 1);
  const topIncidentMonitors = [...counts.entries()]
    .map(([entity, count]) => ({ entity, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const storageAlerts = storage.monitors
    .map((m) => ({ name: m.name, usedPct: m.current.usedPct }))
    .filter((s): s is { name: string; usedPct: number } => s.usedPct != null && s.usedPct >= STORAGE_ALERT_PCT)
    .sort((a, b) => b.usedPct - a.usedPct);

  return {
    overallUptimePct: uptime.overallPct,
    incidentCount: incidents.count,
    agentsTotal: inventory.agents.length,
    monitorsTotal: inventory.monitors.length,
    monitorsEnabled: inventory.monitors.filter((m) => m.enabled).length,
    worstMonitors: uptime.rows.slice(0, 8),
    topIncidentMonitors,
    storageAlerts,
    uptimeTrend: uptime.trend,
    incidentsPerDay: incidents.perDay,
  };
}

// ---------------------------------------------------------------------------
// Document assembly + persistence
// ---------------------------------------------------------------------------

/** The full report document (returned for preview/export and persisted as JSON). */
export interface ReportDoc {
  type: ReportType;
  scope: ReportRequest["scope"];
  days: number;
  from: string;
  to: string;
  generatedAt: string;
  scopeLabel: string;
  windowLabel: string;
  data: unknown;
}

/** Build a report's data without persisting it (for preview + on-the-fly export). */
export async function buildReport(master: MasterDb, telemetry: TelemetryDb, req: ReportRequest): Promise<ReportDoc> {
  const win = resolveWindow(req);
  const generatedAt = new Date().toISOString();
  const scopeLabel = await resolveScopeLabel(master, req.scope);
  let data: unknown;
  switch (req.type) {
    case "summary":
      data = await buildSummaryData(master, telemetry, req.scope, win);
      break;
    case "uptime":
      data = await buildUptimeData(master, telemetry, req.scope, win);
      break;
    case "incidents":
      data = await buildIncidentData(master, telemetry, req.scope, win);
      break;
    case "resource":
      data = await buildResourceData(master, telemetry, req.scope, win);
      break;
    case "inventory":
      data = await buildInventoryData(master);
      break;
    case "storage":
      data = await buildStorageData(master, telemetry, req.scope, win);
      break;
    case "storage-detail":
      data = await buildStorageDetailData(master, telemetry, req.scope, win);
      break;
  }
  return {
    type: req.type,
    scope: req.scope,
    days: win.days,
    from: win.fromIso,
    to: win.untilIso,
    generatedAt,
    scopeLabel,
    windowLabel: win.label,
    data,
  };
}

/** Generate a report, persist it as a JSON file, and return its metadata. */
export async function generateReport(
  master: MasterDb,
  telemetry: TelemetryDb,
  req: ReportRequest,
): Promise<ReportMeta> {
  const report = await buildReport(master, telemetry, req);
  const name = reportFileName(req.type, report.generatedAt);
  const json = JSON.stringify(report, null, 2);
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(join(REPORT_DIR, name), json, "utf8");

  return {
    name,
    type: req.type,
    createdAt: report.generatedAt,
    size: Buffer.byteLength(json),
    scopeLabel: report.scopeLabel,
    windowLabel: report.windowLabel,
  };
}

/** List existing report files (newest first). Reads each file's header for the
 *  friendly scope/window labels, falling back to the file name + stat on error. */
export async function listReports(): Promise<ReportMeta[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(REPORT_DIR);
  } catch {
    return []; // directory not created yet → no reports
  }
  const metas: ReportMeta[] = [];
  for (const name of entries) {
    if (!name.startsWith(FILE_PREFIX) || !name.endsWith(".json")) continue;
    const full = join(REPORT_DIR, name);
    const stat = await fs.stat(full);
    let meta: ReportMeta = { name, type: typeFromName(name), size: stat.size, createdAt: stat.mtime.toISOString() };
    try {
      const doc = JSON.parse(await fs.readFile(full, "utf8")) as Partial<ReportDoc>;
      meta = {
        name,
        type: (doc.type as ReportType) ?? meta.type,
        size: stat.size,
        createdAt: doc.generatedAt ?? meta.createdAt,
        scopeLabel: doc.scopeLabel,
        windowLabel: doc.windowLabel,
      };
    } catch {
      /* keep the stat/filename fallback */
    }
    metas.push(meta);
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Read raw bytes for a named report (path-traversal guarded) — for download/open. */
export async function readReportFile(name: string): Promise<Buffer> {
  return fs.readFile(safeReportPath(name));
}

/** Delete a named report file (path-traversal guarded). */
export async function deleteReport(name: string): Promise<void> {
  await fs.unlink(safeReportPath(name));
}
