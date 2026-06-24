/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Public status-page domain service. Reads the singleton config (master) and, when
 * enabled, composes a COARSE public status snapshot from agent liveness + monitor
 * unit-states + pre-aggregated uptime buckets (telemetry). The resulting DTO is
 * secure-by-construction: only label/status/uptimePct ever leave this module —
 * never ids, hostnames, ips or config.
 */
import { and, eq, gte } from "drizzle-orm";
import {
  agents,
  monitors,
  publicConfig,
  unitStates,
  uptimeBuckets,
  type MasterDb,
  type TelemetryDb,
} from "@argus/db";
import type {
  HealthStatus,
  PublicConfigDTO,
  PublicItemConfig,
  PublicNoticeLevel,
  PublicStatusDTO,
  PublicStatusGroup,
  PublicStatusItem,
} from "@argus/shared";
import { rollup, type Unit } from "@argus/core";

/** The singleton row id. The public config is a single, always-upserted row. */
const SINGLETON_ID = "default";

/** Agents are considered live only if seen within this window (ms). */
const AGENT_STALE_MS = 120_000;

/** Defaults returned when no config row has been persisted yet. */
const DEFAULT_CONFIG: PublicConfigDTO = {
  enabled: false,
  title: "System Status",
  description: "",
  showUptime: true,
  showHistory: true,
  historyDays: 90,
  items: [],
};

/** Read the singleton public-config row, falling back to defaults if absent. */
export async function getPublicConfig(db: MasterDb): Promise<PublicConfigDTO> {
  const [row] = await db.select().from(publicConfig).where(eq(publicConfig.id, SINGLETON_ID)).limit(1);
  if (!row) return { ...DEFAULT_CONFIG };
  const dto: PublicConfigDTO = {
    enabled: row.enabled,
    title: row.title,
    description: row.description ?? "",
    showUptime: row.showUptime,
    showHistory: row.showHistory,
    historyDays: row.historyDays,
    items: row.items,
  };
  if (row.noticeMessage?.trim()) {
    dto.notice = { level: normalizeNoticeLevel(row.noticeLevel), message: row.noticeMessage.trim() };
  }
  return dto;
}

/** Coerce a stored notice level to a valid value (default "info"). */
function normalizeNoticeLevel(v: string | null): PublicNoticeLevel {
  return v === "maintenance" || v === "incident" ? v : "info";
}

/** Upsert the singleton public-config row (id="default") and return the stored DTO. */
export async function updatePublicConfig(db: MasterDb, dto: PublicConfigDTO): Promise<PublicConfigDTO> {
  const now = new Date().toISOString();
  const values = {
    enabled: dto.enabled,
    title: dto.title,
    description: dto.description ?? "",
    showUptime: dto.showUptime,
    showHistory: dto.showHistory,
    historyDays: dto.historyDays,
    noticeLevel: dto.notice?.message.trim() ? normalizeNoticeLevel(dto.notice.level) : null,
    noticeMessage: dto.notice?.message.trim() ? dto.notice.message.trim() : null,
    items: dto.items,
    updatedAt: now,
  };
  await db
    .insert(publicConfig)
    .values({ id: SINGLETON_ID, ...values })
    .onConflictDoUpdate({ target: publicConfig.id, set: values });
  return getPublicConfig(db);
}

/** Compute the coarse public status for a single agent item. */
async function agentStatus(db: MasterDb, refId: string): Promise<HealthStatus> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, refId)).limit(1);
  // revoked / pending / unknown agent → UNKNOWN (never leak that it doesn't exist).
  if (!agent || agent.status !== "approved") return "UNKNOWN";
  if (!agent.lastSeenAt) return "DOWN";
  const lastSeen = new Date(agent.lastSeenAt).getTime();
  return Date.now() - lastSeen <= AGENT_STALE_MS ? "UP" : "DOWN";
}

/**
 * Compute the coarse public status for a single monitor item, plus the
 * (sourceId, entity) pair used to look up uptime. A disabled or missing monitor
 * is UNKNOWN; otherwise we best-effort read its last-known unit state.
 */
async function monitorStatus(
  master: MasterDb,
  telemetry: TelemetryDb,
  refId: string,
): Promise<{ status: HealthStatus; sourceId?: string; entity?: string }> {
  const [monitor] = await master.select().from(monitors).where(eq(monitors.id, refId)).limit(1);
  if (!monitor || !monitor.enabled) return { status: "UNKNOWN" };

  const sourceId = monitor.agentId;
  const entity = monitor.name;
  const [state] = await telemetry
    .select()
    .from(unitStates)
    .where(and(eq(unitStates.sourceId, sourceId), eq(unitStates.entity, entity)))
    .limit(1);

  const status = (state?.status as HealthStatus | undefined) ?? "UNKNOWN";
  return { status, sourceId, entity };
}

/**
 * Sum uptime buckets and return a rounded percentage. With `entity` it covers one
 * monitor; without it, ALL of a source's (agent's) monitors aggregated together.
 */
async function uptimePctFor(
  telemetry: TelemetryDb,
  sourceId: string,
  entity?: string,
): Promise<number | undefined> {
  const where = entity
    ? and(eq(uptimeBuckets.sourceId, sourceId), eq(uptimeBuckets.entity, entity))
    : eq(uptimeBuckets.sourceId, sourceId);
  const rows = await telemetry
    .select({ upSec: uptimeBuckets.upSec, totalSec: uptimeBuckets.totalSec })
    .from(uptimeBuckets)
    .where(where);
  if (rows.length === 0) return undefined;

  let up = 0;
  let total = 0;
  for (const r of rows) {
    up += r.upSec;
    total += r.totalSec;
  }
  if (total <= 0) return undefined;
  return Math.round((up / total) * 100 * 100) / 100;
}

/**
 * Aggregate uptime buckets into coarse daily percentages over the last `days`,
 * oldest→newest. Days with no recorded data are `null`. Used only for the public
 * sparkline — no timestamps, ids or per-bucket detail ever leave this module.
 */
async function uptimeHistoryFor(
  telemetry: TelemetryDb,
  sourceId: string,
  entity: string | undefined,
  days: number,
): Promise<Array<number | null>> {
  // Start at midnight UTC `days-1` days ago so the window covers exactly `days` days.
  const dayMs = 86_400_000;
  const startMs = Date.now() - (days - 1) * dayMs;
  const startDay = new Date(startMs);
  startDay.setUTCHours(0, 0, 0, 0);

  const clauses = [eq(uptimeBuckets.sourceId, sourceId), gte(uptimeBuckets.bucketStart, startDay.toISOString())];
  if (entity) clauses.push(eq(uptimeBuckets.entity, entity));
  const rows = await telemetry
    .select({ bucketStart: uptimeBuckets.bucketStart, upSec: uptimeBuckets.upSec, totalSec: uptimeBuckets.totalSec })
    .from(uptimeBuckets)
    .where(and(...clauses));

  const byDay = new Map<string, { up: number; total: number }>();
  for (const r of rows) {
    const key = r.bucketStart.slice(0, 10); // YYYY-MM-DD
    const acc = byDay.get(key) ?? { up: 0, total: 0 };
    acc.up += r.upSec;
    acc.total += r.totalSec;
    byDay.set(key, acc);
  }

  const out: Array<number | null> = [];
  for (let i = 0; i < days; i++) {
    const key = new Date(startDay.getTime() + i * dayMs).toISOString().slice(0, 10);
    const acc = byDay.get(key);
    out.push(acc && acc.total > 0 ? Math.round((acc.up / acc.total) * 100) : null);
  }
  return out;
}

/**
 * Build the public status snapshot. Returns null when the page is disabled. When
 * enabled, maps each configured item to a coarse PublicStatusItem (label/status/
 * optional uptime + history — never ids), buckets them into named groups (each
 * with its own rollup), and derives `overall` via the core rollup, treating each
 * item as a non-critical unit. Group + item order follows config order.
 */
export async function buildPublicStatus(
  master: MasterDb,
  telemetry: TelemetryDb,
): Promise<PublicStatusDTO | null> {
  const config = await getPublicConfig(master);
  if (!config.enabled) return null;

  // Preserve first-seen group order; "" is the default/ungrouped section.
  const groups = new Map<string, PublicStatusItem[]>();
  const order: string[] = [];
  const units: Unit[] = [];

  for (const cfg of config.items) {
    const { status, uptimePct, history } = await resolveItem(master, telemetry, config, cfg);
    const item: PublicStatusItem = { label: cfg.label, status };
    if (uptimePct !== undefined) item.uptimePct = uptimePct;
    if (history) item.history = history;

    const groupName = cfg.group?.trim() ?? "";
    if (!groups.has(groupName)) {
      groups.set(groupName, []);
      order.push(groupName);
    }
    groups.get(groupName)!.push(item);
    units.push({ status, critical: false });
  }

  const outGroups: PublicStatusGroup[] = order.map((name) => {
    const groupItems = groups.get(name)!;
    return { name, status: rollup(groupItems.map((it) => ({ status: it.status, critical: false }))), items: groupItems };
  });

  const dto: PublicStatusDTO = {
    title: config.title,
    overall: rollup(units),
    groups: outGroups,
    generatedAt: new Date().toISOString(),
  };
  if (config.description?.trim()) dto.description = config.description.trim();
  if (config.notice?.message.trim()) dto.notice = config.notice;
  return dto;
}

/** Resolve one configured item to its coarse status + optional uptime + history. */
async function resolveItem(
  master: MasterDb,
  telemetry: TelemetryDb,
  config: PublicConfigDTO,
  cfg: PublicItemConfig,
): Promise<{ status: HealthStatus; uptimePct?: number; history?: Array<number | null> }> {
  // An agent's uptime/history aggregates ALL its monitors' buckets (sourceId = agentId,
  // any entity). A monitor item is scoped to its single (sourceId, entity).
  const out: { status: HealthStatus; uptimePct?: number; history?: Array<number | null> } = { status: "UNKNOWN" };
  let sourceId: string | undefined;
  let entity: string | undefined;

  if (cfg.kind === "agent") {
    out.status = await agentStatus(master, cfg.refId);
    sourceId = cfg.refId; // buckets key on sourceId = agentId
  } else {
    const m = await monitorStatus(master, telemetry, cfg.refId);
    out.status = m.status;
    sourceId = m.sourceId;
    entity = m.entity;
  }
  if (!sourceId) return out;

  if (config.showUptime) {
    const uptimePct = await uptimePctFor(telemetry, sourceId, entity);
    if (uptimePct !== undefined) out.uptimePct = uptimePct;
  }
  if (config.showHistory) {
    const history = await uptimeHistoryFor(telemetry, sourceId, entity, config.historyDays);
    if (history.some((d) => d !== null)) out.history = history;
  }
  return out;
}
