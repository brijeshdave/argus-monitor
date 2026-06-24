/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Ticker message domain service (CRUD + "active now" resolution). The
 * scheduling decision itself lives in @argus/core (activeTickers) so it stays
 * pure and unit-tested; this layer only maps DB rows to that contract and back.
 */
import { eq } from "drizzle-orm";
import { tickerMessages, userGroups, wallDevices, type MasterDb } from "@argus/db";
import { activeTickers } from "@argus/core";
import { TICKER_SPEED_DEFAULT, TICKER_SPEED_KEY, TICKER_SPEED_MAX, TICKER_SPEED_MIN, type TickerMessageDTO, type TickerSeverity } from "@argus/shared";
import { getSetting, setSetting } from "@/services/settings.js";

type TickerRow = typeof tickerMessages.$inferSelect;

/** Normalise a Postgres timestamp string ("2026-06-24 05:52:57+00") to ISO-8601
 * UTC ("2026-06-24T05:52:57.000Z") — the contract format the frontend round-trips
 * back through z.string().datetime() on save. */
const toIso = (s: string | null): string | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const toDTO = (r: TickerRow): TickerMessageDTO => ({
  id: r.id,
  text: r.text,
  enabled: r.enabled,
  severity: r.severity as TickerSeverity,
  priority: r.priority,
  startsAt: toIso(r.startsAt),
  endsAt: toIso(r.endsAt),
  deviceGroupIds: r.deviceGroupIds ?? [],
  userGroupIds: r.userGroupIds ?? [],
  createdAt: toIso(r.createdAt) ?? r.createdAt,
});

export interface CreateTickerInput {
  text: string;
  enabled?: boolean;
  severity?: TickerSeverity;
  priority?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  deviceGroupIds?: string[];
  userGroupIds?: string[];
}

export interface UpdateTickerInput {
  text?: string;
  enabled?: boolean;
  severity?: TickerSeverity;
  priority?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  deviceGroupIds?: string[];
  userGroupIds?: string[];
}

/** Who is asking for active ticker messages — drives audience targeting. */
export type TickerViewer =
  | { kind: "user"; groupIds: string[] }
  | { kind: "device"; groupId: string | null }
  | { kind: "all" }; // unrestricted (static admin / automation)

/** Does a ticker target this viewer? Empty target lists mean "everyone". */
function matchesViewer(t: TickerMessageDTO, viewer: TickerViewer): boolean {
  if (viewer.kind === "all") return true;
  if (viewer.kind === "user") {
    return t.userGroupIds.length === 0 || t.userGroupIds.some((g) => viewer.groupIds.includes(g));
  }
  // device (wall): match by wall device-group.
  return t.deviceGroupIds.length === 0 || (viewer.groupId !== null && t.deviceGroupIds.includes(viewer.groupId));
}

export async function listTicker(db: MasterDb): Promise<TickerMessageDTO[]> {
  return (await db.select().from(tickerMessages)).map(toDTO);
}

export async function createTicker(db: MasterDb, input: CreateTickerInput): Promise<TickerMessageDTO | undefined> {
  const [row] = await db
    .insert(tickerMessages)
    .values({
      text: input.text,
      enabled: input.enabled ?? true,
      severity: input.severity ?? "info",
      priority: input.priority ?? 0,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      deviceGroupIds: input.deviceGroupIds ?? [],
      userGroupIds: input.userGroupIds ?? [],
    })
    .returning();
  return row ? toDTO(row) : undefined;
}

export async function updateTicker(db: MasterDb, id: string, patch: UpdateTickerInput): Promise<TickerMessageDTO | undefined> {
  const set: Partial<typeof tickerMessages.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.text !== undefined) set.text = patch.text;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.severity !== undefined) set.severity = patch.severity;
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.startsAt !== undefined) set.startsAt = patch.startsAt;
  if (patch.endsAt !== undefined) set.endsAt = patch.endsAt;
  if (patch.deviceGroupIds !== undefined) set.deviceGroupIds = patch.deviceGroupIds;
  if (patch.userGroupIds !== undefined) set.userGroupIds = patch.userGroupIds;

  const [row] = await db.update(tickerMessages).set(set).where(eq(tickerMessages.id, id)).returning();
  return row ? toDTO(row) : undefined;
}

export async function deleteTicker(db: MasterDb, id: string): Promise<boolean> {
  const [row] = await db.delete(tickerMessages).where(eq(tickerMessages.id, id)).returning();
  return Boolean(row);
}

/**
 * Currently-active ticker messages (enabled + in-window), highest priority first.
 * A TickerMessageDTO structurally satisfies the core TickerWindow contract, so it
 * is passed straight through to activeTickers.
 */
/** Global ticker scroll speed (px/sec), clamped to the allowed range. */
export async function getTickerSpeed(db: MasterDb): Promise<number> {
  const raw = await getSetting(db, TICKER_SPEED_KEY);
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? Math.min(Math.max(n, TICKER_SPEED_MIN), TICKER_SPEED_MAX) : TICKER_SPEED_DEFAULT;
}

/** Persist the global ticker scroll speed (px/sec). Returns the clamped value. */
export async function setTickerSpeed(db: MasterDb, px: number): Promise<number> {
  const clamped = Math.min(Math.max(Math.round(px), TICKER_SPEED_MIN), TICKER_SPEED_MAX);
  await setSetting(db, TICKER_SPEED_KEY, clamped);
  return clamped;
}

/** The group ids a user belongs to (for user-group ticker targeting). */
export async function userGroupIdsFor(db: MasterDb, userId: string): Promise<string[]> {
  const rows = await db.select({ groupId: userGroups.groupId }).from(userGroups).where(eq(userGroups.userId, userId));
  return rows.map((r) => r.groupId);
}

/** The wall device-group a paired display belongs to (for device-group targeting). */
export async function deviceGroupIdFor(db: MasterDb, deviceId: string): Promise<string | null> {
  const [row] = await db.select({ groupId: wallDevices.groupId }).from(wallDevices).where(eq(wallDevices.id, deviceId)).limit(1);
  return row?.groupId ?? null;
}

export async function listActiveTicker(db: MasterDb, nowMs: number, viewer: TickerViewer = { kind: "all" }): Promise<TickerMessageDTO[]> {
  const rows = await db.select().from(tickerMessages).where(eq(tickerMessages.enabled, true));
  // Window/priority resolution stays in core; audience targeting is applied here.
  return activeTickers(rows.map(toDTO).filter((t) => matchesViewer(t, viewer)), nowMs);
}
