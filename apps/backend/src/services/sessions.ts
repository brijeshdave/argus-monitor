/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Session domain service. Sessions are a safe projection of refresh-token rows
 * (active = not revoked AND not expired). This service lists them for the self
 * view and the admin manager, and revokes them individually or in bulk. The raw
 * token hash never leaves this layer — callers receive SessionDTO only.
 */
import { createHash } from "node:crypto";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { refreshTokens, type MasterDb } from "@argus/db";
import type { SessionDTO } from "@argus/shared";

/** SHA-256 hex — mirrors auth.ts so a caller can resolve its current session. */
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * List a user's active sessions (newest first). When `currentTokenHash` is given,
 * the matching row is flagged `current: true`.
 */
export async function listSessions(
  db: MasterDb,
  userId: string,
  currentTokenHash?: string,
): Promise<SessionDTO[]> {
  const nowIso = new Date().toISOString();
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, nowIso)));

  return rows
    .map((row) => ({
      id: row.id,
      userId: row.userId,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      current: currentTokenHash !== undefined && row.tokenHash === currentTokenHash,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Revoke a single session by id. Returns true if a matching row was found. */
export async function terminateSession(db: MasterDb, id: string): Promise<boolean> {
  const [row] = await db.select({ id: refreshTokens.id }).from(refreshTokens).where(eq(refreshTokens.id, id)).limit(1);
  if (!row) return false;
  await db.update(refreshTokens).set({ revokedAt: new Date().toISOString() }).where(eq(refreshTokens.id, id));
  return true;
}

/**
 * Revoke all of a user's active sessions, optionally keeping one alive (identified
 * by its token hash — e.g. the caller's own session). Returns the count revoked.
 */
export async function terminateAllForUser(
  db: MasterDb,
  userId: string,
  exceptTokenHash?: string,
): Promise<number> {
  const nowIso = new Date().toISOString();
  const conditions = [eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, nowIso)];
  if (exceptTokenHash !== undefined) conditions.push(ne(refreshTokens.tokenHash, exceptTokenHash));

  const revoked = await db
    .update(refreshTokens)
    .set({ revokedAt: nowIso })
    .where(and(...conditions))
    .returning({ id: refreshTokens.id });
  return revoked.length;
}

/**
 * Revoke all of a user's active sessions EXCEPT one identified by its session id
 * (the refresh-token row id, i.e. the access token's `sid`). Used by a password
 * change so the caller's own session survives. Returns the count revoked.
 */
export async function terminateOtherSessions(
  db: MasterDb,
  userId: string,
  exceptSessionId: string,
): Promise<number> {
  const nowIso = new Date().toISOString();
  const revoked = await db
    .update(refreshTokens)
    .set({ revokedAt: nowIso })
    .where(
      and(
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, nowIso),
        ne(refreshTokens.id, exceptSessionId),
      ),
    )
    .returning({ id: refreshTokens.id });
  return revoked.length;
}
