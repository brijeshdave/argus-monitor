/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Seeds the protected default wallboard layout. It is immutable (isDefault +
 * isSystem) — operators clone it to customize. Idempotent: created once.
 */
import { eq } from "drizzle-orm";
import type { MasterDb } from "@/master/index.js";
import { wallLayouts } from "@/master/schema.js";

export async function seedDefaultWallboard(db: MasterDb): Promise<void> {
  const existing = await db.select({ id: wallLayouts.id }).from(wallLayouts).where(eq(wallLayouts.isDefault, true)).limit(1);
  if (existing.length > 0) return;
  await db.insert(wallLayouts).values({
    name: "Overview",
    description: "Default wallboard — clone to customize.",
    isDefault: true,
    isSystem: true,
    layout: { widgets: [] },
  });
}
