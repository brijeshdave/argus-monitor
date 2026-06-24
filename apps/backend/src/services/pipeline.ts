/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Live ingest pipeline. Given a batch of unit samples from an agent, it diffs them
 * against the last-known state to derive durable status events, refreshes the
 * unit-state baseline, accumulates uptime, and raises plain-language notifications
 * on transitions. Pure derivation lives in @argus/core; this glues it to the DB.
 */
import { and, eq, sql } from "drizzle-orm";
import { logs, notifications, statusEvents, unitStates, uptimeBuckets, type TelemetryDb } from "@argus/db";
import { diffStates, type UnitSample as CoreUnit } from "@argus/core";
import type { HealthStatus, UnitSample } from "@argus/shared";

const BAD: ReadonlyArray<HealthStatus> = ["DOWN", "HANG", "DEGRADED"];
const MAX_INTERVAL_SEC = 3600; // cap uptime attribution after long gaps

const hourBucket = (iso: string): string => `${iso.slice(0, 13)}:00:00.000Z`;

/** Process a batch of unit samples for one source (agent), at time `now`. */
export async function processUnits(db: TelemetryDb, sourceId: string, units: UnitSample[], now = new Date()): Promise<void> {
  if (units.length === 0) return;
  const nowIso = now.toISOString();

  const prevRows = await db.select().from(unitStates).where(eq(unitStates.sourceId, sourceId));
  const prev = new Map<string, { entity: string; status: HealthStatus; pid: number | null; updatedAt: string }>();
  for (const r of prevRows) prev.set(r.entity, { entity: r.entity, status: r.status as HealthStatus, pid: r.pid, updatedAt: r.updatedAt });

  // 1) Derive events (STATUS_CHANGE / SERVICE_RESTART) via the pure core.
  const prevCore = new Map<string, CoreUnit>([...prev].map(([k, v]) => [k, { entity: v.entity, status: v.status, pid: v.pid }]));
  const current: CoreUnit[] = units.map((u) => ({ entity: u.entity, status: u.status, pid: u.pid ?? null }));
  const events = diffStates(prevCore, current);

  if (events.length) {
    await db.insert(statusEvents).values(
      events.map((e) =>
        e.type === "STATUS_CHANGE"
          ? { sourceId, entity: e.entity, type: e.type, oldStatus: e.oldStatus, newStatus: e.newStatus }
          : { sourceId, entity: e.entity, type: e.type, oldPid: e.oldPid, newPid: e.newPid },
      ),
    );
  }

  // 1b) Status changes also become log lines (category "status") so they show up in
  // the Logs view alongside agent logs — a readable up/down/hang/degraded trail.
  const statusLogs = events
    .filter((e): e is Extract<typeof e, { type: "STATUS_CHANGE" }> => e.type === "STATUS_CHANGE")
    .map((e) => ({
      category: "status",
      level: e.newStatus === "UP" ? "info" : e.newStatus === "DEGRADED" ? "warn" : "error",
      sourceId,
      message: `${e.entity}: ${e.oldStatus ?? "—"} → ${e.newStatus}`,
      context: { entity: e.entity, oldStatus: e.oldStatus, newStatus: e.newStatus },
    }));
  if (statusLogs.length) await db.insert(logs).values(statusLogs);

  // 2) Notifications on transitions into a bad state (or recovery to UP).
  const notes = events
    .filter((e): e is Extract<typeof e, { type: "STATUS_CHANGE" }> => e.type === "STATUS_CHANGE")
    .map((e) => buildNotification(sourceId, e.entity, e.newStatus))
    .filter((n): n is NonNullable<typeof n> => n !== null);
  if (notes.length) await db.insert(notifications).values(notes);

  // 3) Uptime: attribute the elapsed interval to the PREVIOUS status it was held in.
  for (const u of units) {
    const p = prev.get(u.entity);
    if (!p) continue;
    const deltaSec = Math.min(MAX_INTERVAL_SEC, Math.max(0, Math.floor((now.getTime() - Date.parse(p.updatedAt)) / 1000)));
    if (deltaSec <= 0) continue;
    const addUp = p.status === "UP" ? deltaSec : 0;
    await db
      .insert(uptimeBuckets)
      .values({ sourceId, entity: u.entity, bucketStart: hourBucket(p.updatedAt), upSec: addUp, totalSec: deltaSec })
      .onConflictDoUpdate({
        target: [uptimeBuckets.sourceId, uptimeBuckets.entity, uptimeBuckets.bucketStart],
        set: { upSec: sql`${uptimeBuckets.upSec} + ${addUp}`, totalSec: sql`${uptimeBuckets.totalSec} + ${deltaSec}` },
      });
  }

  // 4) Refresh the baseline (upsert current samples + latest rich detail).
  for (const u of units) {
    const sample = (u.meta ?? null) as Record<string, unknown> | null;
    await db
      .insert(unitStates)
      .values({ sourceId, entity: u.entity, status: u.status, pid: u.pid ?? null, critical: u.critical ?? false, sample, updatedAt: nowIso })
      .onConflictDoUpdate({
        target: [unitStates.sourceId, unitStates.entity],
        set: { status: u.status, pid: u.pid ?? null, critical: u.critical ?? false, sample, updatedAt: nowIso },
      });
  }
}

function buildNotification(sourceId: string, entity: string, status: HealthStatus) {
  if (status === "UP") {
    return { severity: "info", sourceId, title: `${entity} recovered`, message: `${entity} is back UP.`, plainLanguage: `${entity} is healthy again — no action needed.` };
  }
  if (!BAD.includes(status)) return null;
  const severity = status === "DEGRADED" ? "warning" : "critical";
  const what = status === "DEGRADED" ? "is degraded" : status === "HANG" ? "appears hung" : "is down";
  return {
    severity,
    sourceId,
    title: `${entity} ${what}`,
    message: `${entity} changed to ${status}.`,
    plainLanguage: `${entity} ${what}. Check the host and the service, then restart it if needed.`,
  };
}
