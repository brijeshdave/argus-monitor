/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Retention primitive: delete rows older than N days from a time-stamped table.
 * One generic, reusable function — the per-data-type policy lives in the
 * retention_config table and the scheduling lives in a worker (later phase).
 */
import { lt } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Database } from "@/client.js";

const MS_PER_DAY = 86_400_000;

/**
 * Prune `table` rows whose `tsColumn` is older than `days`. A non-positive or
 * null `days` means "unlimited" and is a safe no-op (never deletes everything).
 * Returns the cutoff ISO timestamp used (null when skipped) for audit/logging.
 */
export async function pruneOlderThan<TSchema extends Record<string, unknown>>(
  db: Database<TSchema>,
  table: PgTable,
  tsColumn: PgColumn,
  days: number | null,
): Promise<string | null> {
  if (days == null || days <= 0) return null;
  const cutoff = new Date(Date.now() - days * MS_PER_DAY).toISOString();
  await db.delete(table).where(lt(tsColumn, cutoff));
  return cutoff;
}
