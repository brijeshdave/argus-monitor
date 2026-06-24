/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * TELEMETRY database schema (Drizzle / pg-core) — high-volume, time-oriented data
 * kept separate from the master store so it can scale/swap (→ TimescaleDB).
 */
import {
  pgTable,
  text,
  integer,
  real,
  bigint,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
// NOTE: relative (not "@/") import — drizzle-kit loads this file outside the TS
// path resolver, so it must not depend on the "@/*" alias.
import { pk } from "../helpers.js";

/** Reusable event-time column (timezone-aware, not null, defaults to now). */
const ts = () =>
  timestamp("ts", { withTimezone: true, mode: "string" }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Status events — service/db/share status changes and service restarts
// ---------------------------------------------------------------------------
export const statusEvents = pgTable(
  "status_events",
  {
    id: pk(),
    sourceId: text("source_id").notNull(),
    entity: text("entity").notNull(),
    type: text("type").notNull(),
    oldStatus: text("old_status"),
    newStatus: text("new_status"),
    oldPid: integer("old_pid"),
    newPid: integer("new_pid"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    ts: ts(),
  },
  (t) => ({
    byEntity: index("status_events_entity_ts_idx").on(t.sourceId, t.entity, t.ts),
  }),
);

// ---------------------------------------------------------------------------
// Client events — TCP client connect/disconnect per service
// ---------------------------------------------------------------------------
export const clientEvents = pgTable(
  "client_events",
  {
    id: pk(),
    sourceId: text("source_id").notNull(),
    service: text("service").notNull(),
    remoteIp: text("remote_ip").notNull(),
    remotePort: integer("remote_port"),
    type: text("type").notNull(),
    durationSec: integer("duration_sec"),
    ts: ts(),
  },
  (t) => ({
    byService: index("client_events_service_ts_idx").on(t.sourceId, t.service, t.ts),
  }),
);

// ---------------------------------------------------------------------------
// Host metrics — per-agent CPU / memory time series
// ---------------------------------------------------------------------------
export const hostMetrics = pgTable(
  "host_metrics",
  {
    id: pk(),
    agentId: text("agent_id").notNull(),
    cpuPct: real("cpu_pct"),
    memPct: real("mem_pct"),
    memUsedMb: integer("mem_used_mb"),
    extra: jsonb("extra").$type<Record<string, unknown>>(),
    ts: ts(),
  },
  (t) => ({
    byAgent: index("host_metrics_agent_ts_idx").on(t.agentId, t.ts),
  }),
);

// ---------------------------------------------------------------------------
// Ping samples — server-side reachability/latency probes for ping monitors. The
// backend (not the agent) runs these, so a host can be confirmed up — and its
// network latency tracked — even when its agent is offline.
// ---------------------------------------------------------------------------
export const pingSamples = pgTable(
  "ping_samples",
  {
    id: pk(),
    monitorId: text("monitor_id").notNull(),
    sourceId: text("source_id").notNull(), // agentId the ping monitor belongs to
    up: boolean("up").notNull(),
    latencyMs: real("latency_ms"), // null on timeout/unreachable
    ts: ts(),
  },
  (t) => ({
    byMonitor: index("ping_samples_monitor_ts_idx").on(t.monitorId, t.ts),
  }),
);

// ---------------------------------------------------------------------------
// Host inventory — latest discoverable services/processes per agent, used to back
// the monitor pick-list. One row per agent (upserted), not time-series.
// ---------------------------------------------------------------------------
type InvItem = { name: string; detail?: string };
export const hostInventory = pgTable("host_inventory", {
  agentId: text("agent_id").primaryKey(),
  services: jsonb("services").$type<InvItem[]>(),
  processes: jsonb("processes").$type<InvItem[]>(),
  collectedAt: timestamp("collected_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// DB metrics — SQL Server DMV snapshots (flexible jsonb payload)
// ---------------------------------------------------------------------------
export const dbMetrics = pgTable(
  "db_metrics",
  {
    id: pk(),
    monitorId: text("monitor_id").notNull(),
    metrics: jsonb("metrics").notNull().$type<Record<string, unknown>>(),
    ts: ts(),
  },
  (t) => ({
    byMonitor: index("db_metrics_monitor_ts_idx").on(t.monitorId, t.ts),
  }),
);

// ---------------------------------------------------------------------------
// Storage metrics — NAS/SMB share capacity and I/O time series
// ---------------------------------------------------------------------------
export const storageMetrics = pgTable(
  "storage_metrics",
  {
    id: pk(),
    storageId: text("storage_id").notNull(),
    share: text("share"),
    usedPct: real("used_pct"),
    usedBytes: bigint("used_bytes", { mode: "number" }),
    totalBytes: bigint("total_bytes", { mode: "number" }),
    metrics: jsonb("metrics").$type<Record<string, unknown>>(),
    ts: ts(),
  },
  (t) => ({
    byStorage: index("storage_metrics_storage_ts_idx").on(t.storageId, t.ts),
  }),
);

// ---------------------------------------------------------------------------
// Folder metrics — per watched-folder size + file/subfolder counts over time
// (one row per folder per scan; powers per-folder growth charts)
// ---------------------------------------------------------------------------
export const folderMetrics = pgTable(
  "folder_metrics",
  {
    id: pk(),
    storageId: text("storage_id").notNull(), // the storage monitor id
    folder: text("folder").notNull(), // folder path (FolderNode.name)
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    fileCount: bigint("file_count", { mode: "number" }),
    folderCount: bigint("folder_count", { mode: "number" }),
    ts: ts(),
  },
  (t) => ({
    byFolder: index("folder_metrics_folder_ts_idx").on(t.storageId, t.folder, t.ts),
  }),
);

// ---------------------------------------------------------------------------
// Process metrics — per-unit CPU% / memory over time (the value an agent reports
// for each process/service/etc. in unit_states.sample). Keyed like the diff
// pipeline: sourceId = agentId, entity = monitor name.
// ---------------------------------------------------------------------------
export const processMetrics = pgTable(
  "process_metrics",
  {
    id: pk(),
    sourceId: text("source_id").notNull(), // agentId
    entity: text("entity").notNull(), // monitor name
    cpuPct: real("cpu_pct"),
    memMb: real("mem_mb"),
    ts: ts(),
  },
  (t) => ({
    byEntity: index("process_metrics_entity_ts_idx").on(t.sourceId, t.entity, t.ts),
  }),
);

// ---------------------------------------------------------------------------
// SNMP metrics — device numeric readings (cpu/mem + numeric custom OIDs) over time
// ---------------------------------------------------------------------------
export const snmpMetrics = pgTable(
  "snmp_metrics",
  {
    id: pk(),
    monitorId: text("monitor_id").notNull(),
    metrics: jsonb("metrics").notNull().$type<Record<string, number>>(),
    ts: ts(),
  },
  (t) => ({
    byMonitor: index("snmp_metrics_monitor_ts_idx").on(t.monitorId, t.ts),
  }),
);

// ---------------------------------------------------------------------------
// Logs — categorized application/agent/system log lines
// ---------------------------------------------------------------------------
export const logs = pgTable(
  "logs",
  {
    id: pk(),
    category: text("category").notNull(),
    level: text("level").notNull(),
    sourceId: text("source_id"),
    message: text("message").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>(),
    ts: ts(),
  },
  (t) => ({
    byCategory: index("logs_category_ts_idx").on(t.category, t.ts),
  }),
);

// ---------------------------------------------------------------------------
// Audit log — before/after change history for admin actions
// ---------------------------------------------------------------------------
export const auditLog = pgTable(
  "audit_log",
  {
    id: pk(),
    actor: text("actor"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    category: text("category").notNull(),
    target: text("target"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    ip: text("ip"),
    ts: ts(),
  },
  (t) => ({
    byCategory: index("audit_log_category_ts_idx").on(t.category, t.ts),
  }),
);

// ---------------------------------------------------------------------------
// Uptime buckets — pre-aggregated uptime windows per entity (no ts column)
// ---------------------------------------------------------------------------
export const uptimeBuckets = pgTable(
  "uptime_buckets",
  {
    id: pk(),
    sourceId: text("source_id").notNull(),
    entity: text("entity").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true, mode: "string" }).notNull(),
    upSec: integer("up_sec").notNull().default(0),
    totalSec: integer("total_sec").notNull().default(0),
    statusSummary: jsonb("status_summary").$type<Record<string, unknown>>(),
  },
  (t) => ({
    byEntity: uniqueIndex("uptime_buckets_entity_start_idx").on(t.sourceId, t.entity, t.bucketStart),
  }),
);

// ---------------------------------------------------------------------------
// Notifications — severity-tagged alerts with optional human-friendly guidance
// ---------------------------------------------------------------------------
export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    severity: text("severity").notNull(),
    sourceId: text("source_id"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    plainLanguage: text("plain_language"),
    acknowledged: boolean("acknowledged").notNull().default(false),
    ts: ts(),
  },
  (t) => ({
    bySeverity: index("notifications_severity_ts_idx").on(t.severity, t.ts),
  }),
);

// ---------------------------------------------------------------------------
// Barrel export — consumed by drizzle.telemetry.config.ts and domain code
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Unit states — last-known status per (source, entity); the diff baseline
// ---------------------------------------------------------------------------
export const unitStates = pgTable(
  "unit_states",
  {
    sourceId: text("source_id").notNull(),
    entity: text("entity").notNull(),
    status: text("status").notNull(),
    pid: integer("pid"),
    critical: boolean("critical").notNull().default(false),
    // Latest rich service/process detail (cpu/mem/uptime/ports/clients); shape =
    // shared UnitMeta. Flexible jsonb so new fields don't need a migration.
    sample: jsonb("sample").$type<Record<string, unknown>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.sourceId, t.entity] }) }),
);

export const telemetrySchema = {
  unitStates,
  statusEvents,
  clientEvents,
  hostMetrics,
  dbMetrics,
  storageMetrics,
  processMetrics,
  logs,
  auditLog,
  uptimeBuckets,
  notifications,
};
