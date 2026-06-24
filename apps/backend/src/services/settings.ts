/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Settings domain service. Provides a typed interface over the `settings` table,
 * which stores arbitrary runtime key/value (jsonb) platform configuration. All
 * mutations use upsert so callers never need to distinguish insert vs. update.
 */
import { eq } from "drizzle-orm";
import { settings, type MasterDb } from "@argus/db";

/**
 * Return all settings rows as a plain key→value map.
 * Consumers should not assume anything about the value shape — treat as `unknown`.
 */
export async function getAllSettings(db: MasterDb): Promise<Record<string, unknown>> {
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * Retrieve a single setting by key.
 * Returns `undefined` when the key does not exist (caller decides on 404 vs. default).
 */
export async function getSetting(db: MasterDb, key: string): Promise<unknown | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value;
}

/**
 * Upsert a setting value. Creates the row on first write; overwrites on subsequent
 * writes. The `value` is stored verbatim as a jsonb column — any JSON-serialisable
 * type is accepted.
 */
export async function setSetting(db: MasterDb, key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date().toISOString() },
    });
}
