/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Two-factor (TOTP) domain service. Orchestrates the @argus/core TOTP primitives
 * with encrypted-at-rest storage: the shared secret is sealed with AES-256-GCM
 * before it touches the users table, and recovery codes are persisted only as
 * SHA-256 hashes. Plaintext secrets/codes leave this layer exactly once — during
 * setup/enable — and never re-serialised afterwards.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { users, type MasterDb } from "@argus/db";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  loadKey,
  otpauthUri,
  verifyTotp,
} from "@argus/core";
import { getSetting } from "@/services/settings.js";
import type { AuthUser } from "@/services/auth.js";

const REQUIRE_2FA_KEY = "security.require2fa";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Load the AES master key from env; throws a 500-mappable error when missing. */
function masterKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new TwoFAConfigError("ENCRYPTION_KEY is not configured.");
  return loadKey(raw);
}

/** Raised when server-side 2FA config (encryption key) is missing → maps to 500. */
export class TwoFAConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwoFAConfigError";
  }
}

/** Raised when a submitted TOTP/recovery code does not verify → maps to 401. */
export class TwoFAVerifyError extends Error {
  constructor(message = "invalid_2fa") {
    super(message);
    this.name = "TwoFAVerifyError";
  }
}

/**
 * Begin enrolment: generate a fresh secret, store it ENCRYPTED on the user (so a
 * page refresh keeps the pending secret), leave totpEnabled false. Returns the
 * plaintext secret + provisioning URI for the user to add to their app.
 */
export async function beginSetup(
  db: MasterDb,
  userId: string,
  username: string,
): Promise<{ secret: string; otpauthUri: string }> {
  const key = masterKey();
  const secret = generateTotpSecret();
  await db
    .update(users)
    .set({ totpSecret: encryptSecret(secret, key), totpEnabled: false, updatedAt: new Date().toISOString() })
    .where(eq(users.id, userId));
  return { secret, otpauthUri: otpauthUri(secret, username) };
}

/**
 * Complete enrolment: verify `code` against the pending (decrypted) secret. On
 * success flip totpEnabled, mint recovery codes, persist their hashes, and return
 * the plaintext recovery codes ONCE. Throws on a bad code or no pending secret.
 */
export async function enable(db: MasterDb, userId: string, code: string): Promise<string[]> {
  const key = masterKey();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.totpSecret) throw new TwoFAVerifyError("no_pending_setup");

  const secret = decryptSecret(user.totpSecret, key);
  if (!verifyTotp(secret, code)) throw new TwoFAVerifyError();

  const recoveryCodes = generateRecoveryCodes();
  await db
    .update(users)
    .set({
      totpEnabled: true,
      totpRecovery: recoveryCodes.map(sha256),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, userId));
  return recoveryCodes;
}

/**
 * Verify a login second factor against an already-loaded user row. Accepts either
 * a valid current TOTP code or an unused recovery code. When a recovery code is
 * used it is consumed (removed from the stored hash list) via `db`.
 */
export async function verifyForLogin(
  db: MasterDb,
  user: AuthUser,
  code: string,
): Promise<{ ok: boolean; usedRecovery?: boolean }> {
  if (!user.totpEnabled || !user.totpSecret) return { ok: false };
  const key = masterKey();

  const secret = decryptSecret(user.totpSecret, key);
  if (verifyTotp(secret, code)) return { ok: true };

  // Fall back to recovery codes: hash the submission and look it up.
  const hashes = user.totpRecovery ?? [];
  const submittedHash = sha256(code.trim().toLowerCase());
  if (hashes.includes(submittedHash)) {
    const remaining = hashes.filter((h) => h !== submittedHash);
    await db
      .update(users)
      .set({ totpRecovery: remaining, updatedAt: new Date().toISOString() })
      .where(eq(users.id, user.id));
    return { ok: true, usedRecovery: true };
  }
  return { ok: false };
}

/** Disable 2FA for a user: clears the enabled flag, secret and recovery codes. */
export async function disable(db: MasterDb, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ totpEnabled: false, totpSecret: null, totpRecovery: null, updatedAt: new Date().toISOString() })
    .where(eq(users.id, userId));
}

/** Admin reset — identical effect to disable; semantically distinct in the audit log. */
export async function resetFor(db: MasterDb, userId: string): Promise<void> {
  await disable(db, userId);
}

/** Whether the platform mandates 2FA (security.require2fa setting; default false). */
export async function isRequired(db: MasterDb): Promise<boolean> {
  return (await getSetting(db, REQUIRE_2FA_KEY)) === true;
}
