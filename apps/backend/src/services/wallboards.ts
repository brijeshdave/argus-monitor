/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Wallboard layout domain service. Layouts are saved, reusable dashboard
 * arrangements. System/default layouts are protected (assertMutable) so a seeded
 * default cannot be edited or deleted; any layout can be cloned into an editable copy.
 */
import { eq } from "drizzle-orm";
import { wallLayouts, type MasterDb } from "@argus/db";
import { assertMutable, ProtectedEntityError } from "@argus/core";
import { WALL_TEMPLATES, type WallLayoutDTO, type WallPanelConfig, type WallTemplate } from "@argus/shared";

type WallLayoutRow = typeof wallLayouts.$inferSelect;

const toDTO = (r: WallLayoutRow): WallLayoutDTO => ({
  id: r.id,
  name: r.name,
  description: r.description,
  isDefault: r.isDefault,
  isSystem: r.isSystem,
  layout: r.layout,
  rotateSec: r.rotateSec,
  template: (WALL_TEMPLATES as readonly string[]).includes(r.template) ? (r.template as WallTemplate) : "flex",
  panelConfig: (r.panelConfig ?? {}) as WallPanelConfig,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export interface CreateLayoutInput {
  name: string;
  description?: string;
  layout?: Record<string, unknown>;
}

export interface UpdateLayoutInput {
  name?: string;
  description?: string;
  layout?: Record<string, unknown>;
}

export async function listLayouts(db: MasterDb): Promise<WallLayoutDTO[]> {
  return (await db.select().from(wallLayouts)).map(toDTO);
}

export async function getLayout(db: MasterDb, id: string): Promise<WallLayoutDTO | undefined> {
  const [row] = await db.select().from(wallLayouts).where(eq(wallLayouts.id, id)).limit(1);
  return row ? toDTO(row) : undefined;
}

export async function createLayout(db: MasterDb, input: CreateLayoutInput): Promise<WallLayoutDTO | undefined> {
  const [row] = await db
    .insert(wallLayouts)
    .values({
      name: input.name,
      description: input.description ?? "",
      layout: input.layout ?? {},
    })
    .returning();
  return row ? toDTO(row) : undefined;
}

export async function updateLayout(db: MasterDb, id: string, patch: UpdateLayoutInput): Promise<WallLayoutDTO | undefined> {
  const [existing] = await db.select().from(wallLayouts).where(eq(wallLayouts.id, id)).limit(1);
  if (!existing) return undefined;
  assertMutable(existing, `Wallboard "${existing.name}"`); // protect seeded system layouts

  const set: Partial<typeof wallLayouts.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.layout !== undefined) set.layout = patch.layout;

  const [row] = await db.update(wallLayouts).set(set).where(eq(wallLayouts.id, id)).returning();
  return row ? toDTO(row) : undefined;
}

/** Set a wallboard's view auto-rotation seconds (0 = paused). Display setting — allowed
 *  even on system/default boards (doesn't touch protected content). */
export async function setRotateSec(db: MasterDb, id: string, sec: number): Promise<WallLayoutDTO | undefined> {
  const clamped = Math.max(0, Math.min(3600, Math.floor(sec)));
  const [row] = await db.update(wallLayouts).set({ rotateSec: clamped, updatedAt: new Date().toISOString() }).where(eq(wallLayouts.id, id)).returning();
  return row ? toDTO(row) : undefined;
}

/** Set a wallboard's rich-wall layout template. Display setting — allowed even on
 *  system/default boards (doesn't touch protected content). */
export async function setTemplate(db: MasterDb, id: string, template: WallTemplate): Promise<WallLayoutDTO | undefined> {
  const [row] = await db.update(wallLayouts).set({ template, updatedAt: new Date().toISOString() }).where(eq(wallLayouts.id, id)).returning();
  return row ? toDTO(row) : undefined;
}

/** Set a wallboard's rich-wall scoping (render mode / hosts / per-host metrics). Display
 *  setting — allowed even on system/default boards (doesn't touch protected widgets). */
export async function setPanelConfig(db: MasterDb, id: string, panelConfig: WallPanelConfig): Promise<WallLayoutDTO | undefined> {
  const [row] = await db.update(wallLayouts).set({ panelConfig: panelConfig as Record<string, unknown>, updatedAt: new Date().toISOString() }).where(eq(wallLayouts.id, id)).returning();
  return row ? toDTO(row) : undefined;
}

/** Make `id` the single default wallboard (what /wall opens). Clears any prior default. */
export async function setDefaultLayout(db: MasterDb, id: string): Promise<WallLayoutDTO | undefined> {
  const [exists] = await db.select().from(wallLayouts).where(eq(wallLayouts.id, id)).limit(1);
  if (!exists) return undefined;
  await db.update(wallLayouts).set({ isDefault: false }).where(eq(wallLayouts.isDefault, true));
  const [row] = await db.update(wallLayouts).set({ isDefault: true, updatedAt: new Date().toISOString() }).where(eq(wallLayouts.id, id)).returning();
  return row ? toDTO(row) : undefined;
}

export async function deleteLayout(db: MasterDb, id: string): Promise<boolean> {
  const [existing] = await db.select().from(wallLayouts).where(eq(wallLayouts.id, id)).limit(1);
  if (!existing) return false;
  assertMutable(existing, `Wallboard "${existing.name}"`);
  if (existing.isDefault) {
    // The default layout is protected from deletion (but is not necessarily isSystem).
    throw new ProtectedEntityError(`Wallboard "${existing.name}" is the default layout and cannot be deleted.`);
  }
  await db.delete(wallLayouts).where(eq(wallLayouts.id, id));
  return true;
}

/**
 * Strip widgets referencing any of `refIds` from every editable layout, so a
 * deleted agent/monitor leaves no dangling "unknown" tile behind. Protected
 * (system/default) layouts are left untouched — the kiosk/builder hide danglers
 * there defensively, and we must not mutate seeded layouts.
 */
export async function pruneEntityRefs(db: MasterDb, refIds: string[]): Promise<void> {
  if (refIds.length === 0) return;
  const drop = new Set(refIds);
  const rows = await db.select().from(wallLayouts);
  for (const row of rows) {
    if (row.isSystem || row.isDefault) continue;
    const widgets = (row.layout as { widgets?: unknown }).widgets;
    if (!Array.isArray(widgets)) continue;
    const kept = widgets.filter(
      (w) => !(w && typeof w === "object" && drop.has((w as { refId?: unknown }).refId as string)),
    );
    if (kept.length !== widgets.length) {
      await db
        .update(wallLayouts)
        .set({ layout: { ...(row.layout as object), widgets: kept }, updatedAt: new Date().toISOString() })
        .where(eq(wallLayouts.id, row.id));
    }
  }
}

/** Clone any layout into a fresh, editable copy (never default/system). */
export async function cloneLayout(db: MasterDb, id: string, input: { name: string }): Promise<WallLayoutDTO | undefined> {
  const [src] = await db.select().from(wallLayouts).where(eq(wallLayouts.id, id)).limit(1);
  if (!src) return undefined;
  const [row] = await db
    .insert(wallLayouts)
    .values({
      name: input.name,
      description: src.description,
      isDefault: false,
      isSystem: false,
      layout: src.layout,
    })
    .returning();
  return row ? toDTO(row) : undefined;
}
