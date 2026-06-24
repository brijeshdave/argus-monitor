/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Wallboard device registration + pairing. A display self-registers and receives a
 * one-time pairing code; an operator then approves it, which mints a device token
 * shown to the admin exactly once (only its SHA-256 hash is stored). The device's
 * token is delivered out-of-band by the operator — pollStatus only reveals status.
 */
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { wallDeviceGroups, wallDevices, type MasterDb } from "@argus/db";
import { DEVICE_SESSION_TTL_DEFAULT, DEVICE_SESSION_TTL_KEY, type WallDeviceDTO, type WallDeviceGroupDTO } from "@argus/shared";
import { getSetting } from "@/services/settings.js";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/** Generate a unique 6-digit numeric pairing code (retries on the rare collision). */
async function genPairingCode(db: MasterDb): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const [ex] = await db.select().from(wallDevices).where(eq(wallDevices.pairingCode, code)).limit(1);
    if (!ex) return code;
  }
  return String(Date.now()).slice(-6);
}

/** Global display session lifetime (seconds) — how long after its last check-in a
 *  device stays valid before it must re-pair. Same for all devices. */
async function sessionTtlSec(db: MasterDb): Promise<number> {
  const v = await getSetting(db, DEVICE_SESSION_TTL_KEY);
  return typeof v === "number" && v > 0 ? v : DEVICE_SESSION_TTL_DEFAULT;
}

type WallDeviceRow = typeof wallDevices.$inferSelect;
type WallDeviceGroupRow = typeof wallDeviceGroups.$inferSelect;

/** A display counts as "online" (its /wall page is open + heartbeating) if it checked in
 *  within this window. The board beats every 20s; 90s tolerates background-timer
 *  throttling so a momentarily-hidden tab doesn't flicker offline. */
const ONLINE_WINDOW_MS = 90_000;

/** @param groupLayoutId the device's group's assigned board (for effectiveLayoutId). */
const toDTO = (r: WallDeviceRow, groupLayoutId: string | null = null): WallDeviceDTO => ({
  id: r.id,
  name: r.name,
  status: r.status as WallDeviceDTO["status"],
  pairingCode: r.status === "pending" ? r.pairingCode : null,
  layoutId: r.layoutId,
  groupId: r.groupId,
  effectiveLayoutId: r.layoutId ?? groupLayoutId,
  online: r.status === "approved" && r.lastSeenAt != null && Date.now() - new Date(r.lastSeenAt).getTime() < ONLINE_WINDOW_MS,
  lastSeenAt: r.lastSeenAt,
  approvedAt: r.approvedAt,
  createdAt: r.createdAt,
});

const groupToDTO = (r: WallDeviceGroupRow): WallDeviceGroupDTO => ({
  id: r.id, name: r.name, layoutId: r.layoutId, createdAt: r.createdAt,
});

/** Re-read a single device with its group's board resolved (for effectiveLayoutId). */
async function hydrate(db: MasterDb, row: WallDeviceRow): Promise<WallDeviceDTO> {
  if (!row.groupId) return toDTO(row);
  const [g] = await db.select().from(wallDeviceGroups).where(eq(wallDeviceGroups.id, row.groupId)).limit(1);
  return toDTO(row, g?.layoutId ?? null);
}

/** Operator: create a display + its 6-digit pairing code (shown in the web UI for the
 *  screen to enter). Status pending until a device claims the code. */
export async function createDevice(db: MasterDb, input: { name: string }): Promise<WallDeviceDTO | undefined> {
  const pairingCode = await genPairingCode(db);
  const [row] = await db
    .insert(wallDevices)
    .values({ name: input.name, status: "pending", pairingCode })
    .returning();
  return row ? hydrate(db, row) : undefined;
}

/**
 * Device: claim a pairing code shown in the web UI. Mints + returns the device token
 * once. If this client (fingerprint) was paired before, the SAME device row is reused —
 * so revoking and reconnecting tracks as one device — and the just-typed code is freed.
 */
export async function claimDevice(
  db: MasterDb,
  input: { code: string; fingerprint?: string | null; name?: string },
): Promise<{ deviceId: string; token: string } | null> {
  const [pending] = await db.select().from(wallDevices)
    .where(eq(wallDevices.pairingCode, input.code)).limit(1);
  if (!pending || pending.status !== "pending") return null;

  const token = `wd_${randomBytes(24).toString("base64url")}`;
  const now = new Date().toISOString();

  // Same physical screen reconnecting → reuse its existing row, drop the new placeholder.
  if (input.fingerprint) {
    const [existing] = await db.select().from(wallDevices)
      .where(eq(wallDevices.fingerprint, input.fingerprint)).limit(1);
    if (existing && existing.id !== pending.id) {
      await db.delete(wallDevices).where(eq(wallDevices.id, pending.id));
      await db.update(wallDevices)
        .set({ status: "approved", approvedAt: now, lastSeenAt: now, tokenHash: sha256(token), name: input.name ?? existing.name })
        .where(eq(wallDevices.id, existing.id));
      return { deviceId: existing.id, token };
    }
  }

  await db.update(wallDevices)
    .set({ status: "approved", approvedAt: now, lastSeenAt: now, tokenHash: sha256(token), fingerprint: input.fingerprint ?? null })
    .where(eq(wallDevices.id, pending.id));
  return { deviceId: pending.id, token };
}

export async function listDevices(db: MasterDb): Promise<WallDeviceDTO[]> {
  const [rows, groups] = await Promise.all([
    db.select().from(wallDevices),
    db.select().from(wallDeviceGroups),
  ]);
  const groupLayout = new Map(groups.map((g) => [g.id, g.layoutId]));
  return rows.map((r) => toDTO(r, r.groupId ? groupLayout.get(r.groupId) ?? null : null));
}

// ── Device groups ───────────────────────────────────────────────────────────

export async function listGroups(db: MasterDb): Promise<WallDeviceGroupDTO[]> {
  return (await db.select().from(wallDeviceGroups)).map(groupToDTO);
}

export async function createGroup(db: MasterDb, input: { name: string }): Promise<WallDeviceGroupDTO | undefined> {
  const [row] = await db.insert(wallDeviceGroups).values({ name: input.name }).returning();
  return row ? groupToDTO(row) : undefined;
}

export async function updateGroup(db: MasterDb, id: string, patch: { name?: string; layoutId?: string | null }): Promise<WallDeviceGroupDTO | undefined> {
  const set: Partial<typeof wallDeviceGroups.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.layoutId !== undefined) set.layoutId = patch.layoutId;
  const [row] = await db.update(wallDeviceGroups).set(set).where(eq(wallDeviceGroups.id, id)).returning();
  return row ? groupToDTO(row) : undefined;
}

export async function deleteGroup(db: MasterDb, id: string): Promise<boolean> {
  // Detach members first so the FK doesn't block deletion.
  await db.update(wallDevices).set({ groupId: null }).where(eq(wallDevices.groupId, id));
  const [row] = await db.delete(wallDeviceGroups).where(eq(wallDeviceGroups.id, id)).returning();
  return Boolean(row);
}

/** Put a device into a group (or null to remove it from any group). */
export async function assignGroup(db: MasterDb, id: string, groupId: string | null): Promise<WallDeviceDTO | undefined> {
  const [row] = await db.update(wallDevices).set({ groupId, updatedAt: new Date().toISOString() }).where(eq(wallDevices.id, id)).returning();
  return row ? hydrate(db, row) : undefined;
}

export async function revokeDevice(db: MasterDb, id: string): Promise<WallDeviceDTO | undefined> {
  const [row] = await db
    .update(wallDevices)
    .set({ status: "revoked", tokenHash: null })
    .where(eq(wallDevices.id, id))
    .returning();
  return row ? hydrate(db, row) : undefined;
}

export async function deleteDevice(db: MasterDb, id: string): Promise<boolean> {
  const [row] = await db.delete(wallDevices).where(eq(wallDevices.id, id)).returning();
  return Boolean(row);
}

export async function assignLayout(db: MasterDb, id: string, layoutId: string | null): Promise<WallDeviceDTO | undefined> {
  const [row] = await db
    .update(wallDevices)
    .set({ layoutId, updatedAt: new Date().toISOString() })
    .where(eq(wallDevices.id, id))
    .returning();
  return row ? hydrate(db, row) : undefined;
}

/**
 * Re-issue a token for a previously-paired screen using its persistent fingerprint, so a
 * closed/reopened display reconnects on its own (no code re-entry) — provided it's still
 * approved (not revoked) and within the session lifetime. Returns null → must re-pair.
 */
export async function reconnectDevice(db: MasterDb, fingerprint: string): Promise<{ deviceId: string; token: string } | null> {
  const [row] = await db.select().from(wallDevices).where(eq(wallDevices.fingerprint, fingerprint)).limit(1);
  if (!row || row.status !== "approved") return null;
  const base = row.lastSeenAt ?? row.approvedAt;
  if (base && Date.now() - new Date(base).getTime() > (await sessionTtlSec(db)) * 1000) return null;
  const token = `wd_${randomBytes(24).toString("base64url")}`;
  await db.update(wallDevices)
    .set({ tokenHash: sha256(token), lastSeenAt: new Date().toISOString() })
    .where(eq(wallDevices.id, row.id));
  return { deviceId: row.id, token };
}

/**
 * Resolve a presented raw device token to its approved device row (for device WS/REST).
 * Enforces the global session TTL as a sliding window from the device's last check-in:
 * an always-on display never expires, but one offline longer than the TTL must re-pair.
 */
export async function resolveDeviceToken(db: MasterDb, rawToken: string): Promise<WallDeviceRow | null> {
  const [row] = await db.select().from(wallDevices).where(eq(wallDevices.tokenHash, sha256(rawToken))).limit(1);
  if (!row || row.status !== "approved") return null;
  const base = row.lastSeenAt ?? row.approvedAt;
  if (base) {
    const ttlMs = (await sessionTtlSec(db)) * 1000;
    if (Date.now() - new Date(base).getTime() > ttlMs) return null; // session expired → re-pair
  }
  return row;
}

/** Record that a device just checked in (lastSeenAt) — fire-and-forget from auth. */
export async function touchDevice(db: MasterDb, id: string): Promise<void> {
  await db.update(wallDevices).set({ lastSeenAt: new Date().toISOString() }).where(eq(wallDevices.id, id));
}

/** What an approved device needs to render: its name + resolved (effective) board id. */
export async function getDeviceBundle(db: MasterDb, deviceId: string): Promise<{ name: string; layoutId: string | null } | null> {
  const [row] = await db.select().from(wallDevices).where(eq(wallDevices.id, deviceId)).limit(1);
  if (!row) return null;
  let groupLayoutId: string | null = null;
  if (row.groupId) {
    const [g] = await db.select().from(wallDeviceGroups).where(eq(wallDeviceGroups.id, row.groupId)).limit(1);
    groupLayoutId = g?.layoutId ?? null;
  }
  return { name: row.name, layoutId: row.layoutId ?? groupLayoutId };
}
