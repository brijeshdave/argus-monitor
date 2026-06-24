/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Read models over the telemetry DB: paginated audit, logs, status events,
 * notifications and uptime. Filter-driven (date range, source, search, etc.) with
 * selectable sort order. Rows are enriched with human-friendly names resolved from
 * the master DB (agent / user / monitor) so the UI never shows bare UUIDs.
 */
import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import {
  agents, auditLog, logs, monitors, notifications, statusEvents, uptimeBuckets, users,
  type MasterDb, type TelemetryDb,
} from "@argus/db";
import type { Page } from "@argus/shared";

export interface PageQuery {
  limit?: number;
  offset?: number;
  /** Inclusive lower/upper time bounds (ISO or YYYY-MM-DD). */
  from?: string;
  to?: string;
  /** Free-text search (per-endpoint columns). */
  q?: string;
  /** Sort by time: newest-first (default) or oldest-first. */
  sort?: "asc" | "desc";
}

type Row = Record<string, unknown>;

const clamp = (q: PageQuery) => ({
  limit: Math.min(Math.max(q.limit ?? 50, 1), 500),
  offset: Math.max(q.offset ?? 0, 0),
});

const whereOf = (clauses: Array<SQL | undefined>): SQL | undefined => {
  const xs = clauses.filter((c): c is SQL => Boolean(c));
  return xs.length ? and(...xs) : undefined;
};

/** Normalise a date-only string to a start/end-of-day ISO stamp; pass ISO through. */
const startIso = (s?: string) => (!s ? undefined : s.length === 10 ? `${s}T00:00:00.000Z` : s);
const endIso = (s?: string) => (!s ? undefined : s.length === 10 ? `${s}T23:59:59.999Z` : s);

// ---------------------------------------------------------------------------
// Name resolution — bare ids → human labels (master DB).
// ---------------------------------------------------------------------------

interface NameMaps {
  agent: Map<string, string>;
  user: Map<string, string>;
  monitor: Map<string, string>;
}

/** Build id→name maps once per request (these tables are small in practice). */
async function buildNameMaps(master: MasterDb): Promise<NameMaps> {
  const [ag, us, mo] = await Promise.all([
    master.select({ id: agents.id, name: agents.name }).from(agents),
    master.select({ id: users.id, username: users.username }).from(users),
    master.select({ id: monitors.id, name: monitors.name }).from(monitors),
  ]);
  return {
    agent: new Map(ag.map((a) => [a.id, a.name])),
    user: new Map(us.map((u) => [u.id, u.username])),
    monitor: new Map(mo.map((m) => [m.id, m.name])),
  };
}

/** Resolve an audit `target` across the known id spaces; fall back to the raw value. */
function resolveTarget(maps: NameMaps, target: unknown): { targetName: string | null; targetKind: string | null } {
  if (typeof target !== "string" || !target) return { targetName: null, targetKind: null };
  if (maps.agent.has(target)) return { targetName: maps.agent.get(target)!, targetKind: "agent" };
  if (maps.user.has(target)) return { targetName: maps.user.get(target)!, targetKind: "user" };
  if (maps.monitor.has(target)) return { targetName: maps.monitor.get(target)!, targetKind: "monitor" };
  return { targetName: target, targetKind: null }; // already human (report name, setting key, …)
}

const sourceName = (maps: NameMaps, sourceId: unknown): string | null =>
  typeof sourceId === "string" && sourceId ? maps.agent.get(sourceId) ?? null : null;

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export async function listAudit(
  master: MasterDb,
  db: TelemetryDb,
  q: PageQuery & { category?: string; action?: string; actor?: string },
): Promise<Page<Row>> {
  const { limit, offset } = clamp(q);
  const search = q.q ? `%${q.q}%` : undefined;
  const w = whereOf([
    q.category ? eq(auditLog.category, q.category) : undefined,
    q.action ? eq(auditLog.action, q.action) : undefined,
    q.actor ? eq(auditLog.actor, q.actor) : undefined,
    startIso(q.from) ? gte(auditLog.ts, startIso(q.from)!) : undefined,
    endIso(q.to) ? lte(auditLog.ts, endIso(q.to)!) : undefined,
    search ? or(ilike(auditLog.action, search), ilike(auditLog.target, search)) : undefined,
  ]);
  const dir = q.sort === "asc" ? asc(auditLog.ts) : desc(auditLog.ts);
  const [rows, total, maps] = await Promise.all([
    db.select().from(auditLog).where(w).orderBy(dir).limit(limit).offset(offset),
    db.select({ c: sql<number>`count(*)::int` }).from(auditLog).where(w),
    buildNameMaps(master),
  ]);
  const enriched = rows.map((r) => ({
    ...r,
    actorName: r.actor ? maps.user.get(r.actor) ?? null : null,
    ...resolveTarget(maps, r.target),
  }));
  return { rows: enriched, total: total[0]?.c ?? 0, limit, offset };
}

export async function listLogs(
  master: MasterDb,
  db: TelemetryDb,
  q: PageQuery & { category?: string; level?: string; sourceId?: string },
): Promise<Page<Row>> {
  const { limit, offset } = clamp(q);
  const search = q.q ? `%${q.q}%` : undefined;
  const w = whereOf([
    q.category ? eq(logs.category, q.category) : undefined,
    q.level ? eq(logs.level, q.level) : undefined,
    q.sourceId ? eq(logs.sourceId, q.sourceId) : undefined,
    startIso(q.from) ? gte(logs.ts, startIso(q.from)!) : undefined,
    endIso(q.to) ? lte(logs.ts, endIso(q.to)!) : undefined,
    search ? ilike(logs.message, search) : undefined,
  ]);
  const dir = q.sort === "asc" ? asc(logs.ts) : desc(logs.ts);
  const [rows, total, maps] = await Promise.all([
    db.select().from(logs).where(w).orderBy(dir).limit(limit).offset(offset),
    db.select({ c: sql<number>`count(*)::int` }).from(logs).where(w),
    buildNameMaps(master),
  ]);
  const enriched = rows.map((r) => ({ ...r, sourceName: sourceName(maps, r.sourceId) }));
  return { rows: enriched, total: total[0]?.c ?? 0, limit, offset };
}

export async function listEvents(
  master: MasterDb,
  db: TelemetryDb,
  q: PageQuery & { sourceId?: string; entity?: string },
): Promise<Page<Row>> {
  const { limit, offset } = clamp(q);
  const w = whereOf([
    q.sourceId ? eq(statusEvents.sourceId, q.sourceId) : undefined,
    q.entity ? eq(statusEvents.entity, q.entity) : undefined,
    startIso(q.from) ? gte(statusEvents.ts, startIso(q.from)!) : undefined,
    endIso(q.to) ? lte(statusEvents.ts, endIso(q.to)!) : undefined,
  ]);
  const dir = q.sort === "asc" ? asc(statusEvents.ts) : desc(statusEvents.ts);
  const [rows, total, maps] = await Promise.all([
    db.select().from(statusEvents).where(w).orderBy(dir).limit(limit).offset(offset),
    db.select({ c: sql<number>`count(*)::int` }).from(statusEvents).where(w),
    buildNameMaps(master),
  ]);
  const enriched = rows.map((r) => ({ ...r, sourceName: sourceName(maps, r.sourceId) }));
  return { rows: enriched, total: total[0]?.c ?? 0, limit, offset };
}

export async function listNotifications(
  master: MasterDb,
  db: TelemetryDb,
  q: PageQuery & { severity?: string; acknowledged?: boolean; sourceId?: string },
): Promise<Page<Row>> {
  const { limit, offset } = clamp(q);
  const search = q.q ? `%${q.q}%` : undefined;
  const w = whereOf([
    q.severity ? eq(notifications.severity, q.severity) : undefined,
    q.acknowledged !== undefined ? eq(notifications.acknowledged, q.acknowledged) : undefined,
    q.sourceId ? eq(notifications.sourceId, q.sourceId) : undefined,
    startIso(q.from) ? gte(notifications.ts, startIso(q.from)!) : undefined,
    endIso(q.to) ? lte(notifications.ts, endIso(q.to)!) : undefined,
    search ? or(ilike(notifications.title, search), ilike(notifications.message, search)) : undefined,
  ]);
  const dir = q.sort === "asc" ? asc(notifications.ts) : desc(notifications.ts);
  const [rows, total, maps] = await Promise.all([
    db.select().from(notifications).where(w).orderBy(dir).limit(limit).offset(offset),
    db.select({ c: sql<number>`count(*)::int` }).from(notifications).where(w),
    buildNameMaps(master),
  ]);
  const enriched = rows.map((r) => ({ ...r, sourceName: sourceName(maps, r.sourceId) }));
  return { rows: enriched, total: total[0]?.c ?? 0, limit, offset };
}

export async function acknowledgeNotification(db: TelemetryDb, id: string): Promise<boolean> {
  const [row] = await db.update(notifications).set({ acknowledged: true }).where(eq(notifications.id, id)).returning();
  return Boolean(row);
}

/** Uptime buckets for a source/entity, oldest-first (for charting). */
export async function listUptime(db: TelemetryDb, q: { sourceId?: string; entity?: string; from?: string }) {
  const w = whereOf([
    q.sourceId ? eq(uptimeBuckets.sourceId, q.sourceId) : undefined,
    q.entity ? eq(uptimeBuckets.entity, q.entity) : undefined,
    q.from ? gte(uptimeBuckets.bucketStart, q.from) : undefined,
  ]);
  const rows = await db.select().from(uptimeBuckets).where(w).orderBy(uptimeBuckets.bucketStart).limit(2000);
  return { rows };
}
