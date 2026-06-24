/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Retention enforcement. Reads the per-data-type policy from retention_config and
 * prunes each telemetry table to its configured window (null/0 = keep forever).
 * Runs in-process on a daily timer so it works in single-node mode (no workers),
 * consistent with the other server-side schedulers. The generic pruneOlderThan
 * primitive does the deletes; this module just owns the data-type → table map.
 */
import type { FastifyInstance } from "fastify";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  auditLog, clientEvents, dbMetrics, folderMetrics, hostMetrics, logs, notifications,
  pingSamples, processMetrics, pruneOlderThan, snmpMetrics, statusEvents, storageMetrics, uptimeBuckets,
} from "@argus/db";
import { listRetention } from "@/services/retention.js";

const DAY_MS = 86_400_000;

/** data_type → (telemetry table, timestamp column to compare against). */
const TARGETS: Record<string, { table: PgTable; ts: PgColumn }> = {
  status_events: { table: statusEvents, ts: statusEvents.ts },
  client_events: { table: clientEvents, ts: clientEvents.ts },
  host_metrics: { table: hostMetrics, ts: hostMetrics.ts },
  ping_samples: { table: pingSamples, ts: pingSamples.ts },
  db_metrics: { table: dbMetrics, ts: dbMetrics.ts },
  storage_metrics: { table: storageMetrics, ts: storageMetrics.ts },
  snmp_metrics: { table: snmpMetrics, ts: snmpMetrics.ts },
  folder_metrics: { table: folderMetrics, ts: folderMetrics.ts },
  process_metrics: { table: processMetrics, ts: processMetrics.ts },
  logs: { table: logs, ts: logs.ts },
  audit_log: { table: auditLog, ts: auditLog.ts },
  notifications: { table: notifications, ts: notifications.ts },
  uptime_buckets: { table: uptimeBuckets, ts: uptimeBuckets.bucketStart },
};

/** Prune every configured data type once. Returns a per-type cutoff summary. */
export async function runRetentionSweep(app: FastifyInstance): Promise<Record<string, string>> {
  const rows = await listRetention(app.master);
  const pruned: Record<string, string> = {};
  for (const row of rows) {
    const target = TARGETS[row.dataType];
    if (!target || row.days == null || row.days <= 0) continue;
    try {
      const cutoff = await pruneOlderThan(app.telemetry, target.table, target.ts, row.days);
      if (cutoff) pruned[row.dataType] = cutoff;
    } catch (err) {
      app.log.warn({ err, dataType: row.dataType }, "retention prune failed");
    }
  }
  if (Object.keys(pruned).length) app.log.info({ pruned }, "retention sweep");
  return pruned;
}

/** Start the daily retention sweeper; returns a stop fn + registers onClose. */
export function startRetentionScheduler(app: FastifyInstance): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runRetentionSweep(app); }
    catch (err) { app.log.error({ err }, "retention sweep failed"); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), DAY_MS);
  timer.unref?.();
  // First run a minute after start so it doesn't compete with boot work.
  const first = setTimeout(() => void tick(), 60_000);
  first.unref?.();
  const stop = () => { clearInterval(timer); clearTimeout(first); };
  app.addHook("onClose", async () => stop());
  return stop;
}
