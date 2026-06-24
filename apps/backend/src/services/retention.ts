/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Retention domain service. Manages per-data-type pruning policies stored in the
 * `retention_config` table. `days = null` means unlimited retention (the safe default).
 * Negative values are rejected at the route layer before reaching this service.
 */
import { eq } from "drizzle-orm";
import { RETENTION_DATA_TYPES, retentionConfig, type MasterDb } from "@argus/db";

/** A single retention row as returned from the database. */
export type RetentionRow = typeof retentionConfig.$inferSelect;

/**
 * Return a retention row for EVERY known data type (merged with stored values), in
 * the canonical order — so newly-added types always appear in the UI even before a
 * policy is saved or the seed runs. Unset types default to null (unlimited).
 */
export async function listRetention(db: MasterDb): Promise<RetentionRow[]> {
  const stored = new Map((await db.select().from(retentionConfig)).map((r) => [r.dataType, r]));
  return RETENTION_DATA_TYPES.map(
    (dataType) => stored.get(dataType) ?? { dataType, days: null, createdAt: null as unknown as string, updatedAt: null as unknown as string },
  );
}

/**
 * Upsert the retention policy for a single data type.
 * `days = null` means unlimited; any positive integer sets the pruning window.
 * Negative values are the caller's responsibility to reject before this is invoked.
 */
export async function setRetention(
  db: MasterDb,
  dataType: string,
  days: number | null,
): Promise<RetentionRow> {
  const [row] = await db
    .insert(retentionConfig)
    .values({ dataType, days, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: retentionConfig.dataType,
      set: { days, updatedAt: new Date().toISOString() },
    })
    .returning();
  // The table uses dataType as a PK so a returning() row is always present.
  return row!;
}
