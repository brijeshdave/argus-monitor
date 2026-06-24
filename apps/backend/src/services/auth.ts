/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Authentication domain service: local password verification and rotating
 * refresh tokens. Refresh tokens are opaque random strings; only their SHA-256
 * hash is stored, and each is single-use (rotated on refresh, revoked on logout).
 * Access (JWT) issuance lives in the route, which has the configured signer.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { refreshTokens, users, type MasterDb } from "@argus/db";
import { verifyPassword } from "@argus/core";

export type AuthUser = typeof users.$inferSelect;

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Device/connection metadata captured when a refresh token is issued or rotated. */
export interface TokenMeta {
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * Look up a usable local-auth user by username. Returns the row only when it can
 * authenticate locally (exists, not disabled, local provider, has a password hash);
 * else null. Performs NO password check — used by the login route, which needs the
 * row first to evaluate the per-account lockout before verifying the password.
 */
export async function findLocalUser(db: MasterDb, username: string): Promise<AuthUser | null> {
  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!user || user.disabled || user.authProvider !== "local" || !user.passwordHash) return null;
  return user;
}

/** Constant-ish password check against a (known-present) hash. */
export function checkPassword(user: AuthUser, password: string): boolean {
  return !!user.passwordHash && verifyPassword(password, user.passwordHash);
}

/** Stamp the last-login timestamp after a fully successful authentication. */
export async function markLoggedIn(db: MasterDb, userId: string): Promise<void> {
  await db.update(users).set({ lastLoginAt: new Date().toISOString() }).where(eq(users.id, userId));
}

/** Verify local credentials. Returns the user on success, else null (no detail leak). */
export async function verifyLocalLogin(db: MasterDb, username: string, password: string): Promise<AuthUser | null> {
  const user = await findLocalUser(db, username);
  if (!user || !checkPassword(user, password)) return null;
  await markLoggedIn(db, user.id);
  return user;
}

/**
 * Mint a new opaque refresh token, store its hash + device meta, and return both
 * the raw token and the inserted row id. The id doubles as the session id (`sid`)
 * embedded in the access token, so revoking this row instantly kills its access
 * token (see `isSessionLive` + the `authenticate` preHandler).
 */
export async function issueRefreshToken(
  db: MasterDb,
  userId: string,
  ttlSec: number,
  meta?: TokenMeta,
): Promise<{ token: string; id: string }> {
  const raw = randomBytes(32).toString("base64url");
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
  const [row] = await db
    .insert(refreshTokens)
    .values({
      userId,
      tokenHash: sha256(raw),
      expiresAt,
      userAgent: meta?.userAgent ?? null,
      ip: meta?.ip ?? null,
      lastUsedAt: nowIso,
    })
    .returning({ id: refreshTokens.id });
  if (!row) throw new Error("failed to persist refresh token");
  return { token: raw, id: row.id };
}

/**
 * Rotate a refresh token: validate (exists, not revoked, not expired), revoke the
 * old one, and issue a fresh token carrying the device meta forward. Returns the
 * user id, new token and the NEW row id (the new session id, to bind the next
 * access token to), or null. Single-use rotation is preserved.
 */
export async function rotateRefreshToken(
  db: MasterDb,
  rawToken: string,
  ttlSec: number,
): Promise<{ userId: string; refreshToken: string; sessionId: string } | null> {
  const nowIso = new Date().toISOString();
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tokenHash, sha256(rawToken)), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, nowIso)))
    .limit(1);
  if (!row) return null;

  await db.update(refreshTokens).set({ revokedAt: nowIso, lastUsedAt: nowIso }).where(eq(refreshTokens.id, row.id));
  // Carry the originating device/connection metadata onto the rotated row.
  const { token: refreshToken, id: sessionId } = await issueRefreshToken(db, row.userId, ttlSec, {
    userAgent: row.userAgent,
    ip: row.ip,
  });
  return { userId: row.userId, refreshToken, sessionId };
}

/** The user id owning a raw refresh token, or null — used to attribute a logout. */
export async function userIdForRefreshToken(db: MasterDb, rawToken: string): Promise<string | null> {
  const [row] = await db.select({ userId: refreshTokens.userId }).from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(rawToken))).limit(1);
  return row?.userId ?? null;
}

/** Revoke a refresh token (logout). Idempotent. */
export async function revokeRefreshToken(db: MasterDb, rawToken: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(refreshTokens.tokenHash, sha256(rawToken)), isNull(refreshTokens.revokedAt)));
}

/**
 * Bump a user's token version, instantly invalidating ALL of their already-issued
 * access tokens (their `tv` claim no longer matches). Call on global-revoke events
 * (password change, 2FA reset, terminate-all-sessions).
 */
export async function bumpTokenVersion(db: MasterDb, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId));
}

/** Current token version for a user, or null if the user no longer exists. */
export async function getTokenVersion(db: MasterDb, userId: string): Promise<number | null> {
  const [row] = await db.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, userId)).limit(1);
  return row ? row.tokenVersion : null;
}

/** True if the session (refresh-token row) still exists, is not revoked and not expired. */
export async function isSessionLive(db: MasterDb, sessionId: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const [row] = await db
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.id, sessionId), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, nowIso)))
    .limit(1);
  return !!row;
}

/** Shape a user row for API responses — never leaks credentials (password / TOTP secret / recovery hashes). */
export function toPublicUser(user: AuthUser) {
  const { passwordHash: _pw, totpSecret: _secret, totpRecovery: _recovery, ...rest } = user;
  return rest;
}
