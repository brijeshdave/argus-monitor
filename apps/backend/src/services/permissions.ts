/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Permissions catalogue service. The permissions table is seeded from the
 * PERMISSION_CATALOGUE in @argus/shared and is read-only at runtime — permissions
 * are defined in code, not created via the UI. This service exposes them so the
 * roles editor can present a full, ordered list.
 */
import { asc } from "drizzle-orm";
import { permissions, type MasterDb } from "@argus/db";

/** Return all permission rows ordered alphabetically by key. */
export async function listPermissions(db: MasterDb) {
  return db.select().from(permissions).orderBy(asc(permissions.key));
}
