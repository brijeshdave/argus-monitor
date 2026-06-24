/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Per-monitor time-series for wallboard tiles: a recent latency sparkline (from
 * ping_samples) and a rolling 24h uptime % (from uptime_buckets). Batched by id so
 * a board fetches every tile's history in one round-trip.
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import { monitors, pingSamples, uptimeBuckets, type MasterDb, type TelemetryDb } from "@argus/db";
import type { MonitorSeries } from "@argus/shared";

/** Most recent latency points to keep per monitor (≈ last ~15m at a 30s interval). */
const MAX_POINTS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function getMonitorSeries(
  master: MasterDb,
  telemetry: TelemetryDb,
  monitorIds: string[],
): Promise<Record<string, MonitorSeries>> {
  const out: Record<string, MonitorSeries> = {};
  if (monitorIds.length === 0) return out;
  for (const id of monitorIds) out[id] = { latency: [], uptimePct: null };

  // Map monitor id → (agentId, name) so we can reach its uptime buckets.
  const monRows = await master
    .select({ id: monitors.id, agentId: monitors.agentId, name: monitors.name })
    .from(monitors)
    .where(inArray(monitors.id, monitorIds));

  // Latency sparkline: recent ping samples, oldest→newest, capped per monitor.
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const samples = await telemetry
    .select({ monitorId: pingSamples.monitorId, latencyMs: pingSamples.latencyMs, ts: pingSamples.ts })
    .from(pingSamples)
    .where(and(inArray(pingSamples.monitorId, monitorIds), gte(pingSamples.ts, since)));
  samples.sort((a, b) => a.ts.localeCompare(b.ts));
  for (const s of samples) {
    if (s.latencyMs == null) continue;
    const series = out[s.monitorId];
    if (series) series.latency.push(s.latencyMs);
  }
  for (const id of monitorIds) {
    const series = out[id];
    if (series && series.latency.length > MAX_POINTS) series.latency = series.latency.slice(-MAX_POINTS);
  }

  // 24h uptime %: sum(upSec)/sum(totalSec) over the entity's buckets.
  for (const m of monRows) {
    const buckets = await telemetry
      .select({ upSec: uptimeBuckets.upSec, totalSec: uptimeBuckets.totalSec })
      .from(uptimeBuckets)
      .where(and(eq(uptimeBuckets.sourceId, m.agentId), eq(uptimeBuckets.entity, m.name), gte(uptimeBuckets.bucketStart, since)));
    let up = 0;
    let total = 0;
    for (const b of buckets) {
      up += b.upSec;
      total += b.totalSec;
    }
    const series = out[m.id];
    if (series) series.uptimePct = total > 0 ? (up / total) * 100 : null;
  }

  return out;
}
