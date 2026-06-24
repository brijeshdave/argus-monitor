/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Seeds default per-data-type retention rows. Defaults to NULL (unlimited) so the
 * platform never deletes data until an operator explicitly sets a window — a
 * data-safety default. Idempotent.
 */
import type { MasterDb } from "@/master/index.js";
import { retentionConfig } from "@/master/schema.js";

/** Telemetry data types that carry their own retention policy. */
export const RETENTION_DATA_TYPES = [
  "status_events",
  "client_events",
  "host_metrics",
  "ping_samples",
  "db_metrics",
  "storage_metrics",
  "snmp_metrics",
  "folder_metrics",
  "process_metrics",
  "logs",
  "audit_log",
  "notifications",
  "uptime_buckets",
] as const;

export async function seedRetentionDefaults(db: MasterDb): Promise<void> {
  await db
    .insert(retentionConfig)
    .values(RETENTION_DATA_TYPES.map((dataType) => ({ dataType, days: null })))
    .onConflictDoNothing({ target: retentionConfig.dataType });
}
