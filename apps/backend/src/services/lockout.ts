/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Per-account login lockout. After N consecutive failed local logins an account is
 * locked for a cooldown window; a successful login (or an admin/security action)
 * clears it. Policy is read from the `security.lockout` setting with safe defaults,
 * so the feature works out of the box and is tunable without code changes.
 */
import { eq } from "drizzle-orm";
import { users, type MasterDb } from "@argus/db";
import { getSetting } from "@/services/settings.js";
import type { AuthUser } from "@/services/auth.js";

/** Tunable lockout policy, persisted under the `security.lockout` setting key. */
export interface LockoutPolicy {
  /** Consecutive failed attempts that trigger a lock. */
  maxAttempts: number;
  /** Cooldown duration (minutes) the account stays locked once triggered. */
  windowMinutes: number;
}

export const LOCKOUT_SETTING_KEY = "security.lockout";
const DEFAULT_POLICY: LockoutPolicy = { maxAttempts: 5, windowMinutes: 15 };

/** Resolve the effective lockout policy, falling back to defaults for missing/invalid fields. */
export async function getLockoutPolicy(db: MasterDb): Promise<LockoutPolicy> {
  const raw = await getSetting(db, LOCKOUT_SETTING_KEY);
  if (!raw || typeof raw !== "object") return { ...DEFAULT_POLICY };
  const obj = raw as Record<string, unknown>;
  const maxAttempts =
    typeof obj.maxAttempts === "number" && obj.maxAttempts > 0 ? obj.maxAttempts : DEFAULT_POLICY.maxAttempts;
  const windowMinutes =
    typeof obj.windowMinutes === "number" && obj.windowMinutes > 0 ? obj.windowMinutes : DEFAULT_POLICY.windowMinutes;
  return { maxAttempts, windowMinutes };
}

/** True when the account is currently locked (a future `lockedUntil` instant). */
export function isLocked(user: Pick<AuthUser, "lockedUntil">): boolean {
  return user.lockedUntil != null && Date.parse(user.lockedUntil) > Date.now();
}

/** Result of recording a failed attempt — reflects the account's post-update lock state. */
export interface LockState {
  locked: boolean;
  lockedUntil: string | null;
  failedLoginCount: number;
}

/**
 * Record a failed login: increment the consecutive-failure counter, and once it
 * reaches `maxAttempts` flip the account into the locked state (count reset to 0)
 * for `windowMinutes`. Returns the resulting lock state.
 */
export async function recordFailure(db: MasterDb, user: AuthUser, policy: LockoutPolicy): Promise<LockState> {
  const nowIso = new Date().toISOString();
  const nextCount = user.failedLoginCount + 1;

  if (nextCount >= policy.maxAttempts) {
    const lockedUntil = new Date(Date.now() + policy.windowMinutes * 60_000).toISOString();
    await db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil, updatedAt: nowIso })
      .where(eq(users.id, user.id));
    return { locked: true, lockedUntil, failedLoginCount: 0 };
  }

  await db.update(users).set({ failedLoginCount: nextCount, updatedAt: nowIso }).where(eq(users.id, user.id));
  return { locked: false, lockedUntil: null, failedLoginCount: nextCount };
}

/** Clear the failure counter + lock on a successful login. */
export async function recordSuccess(db: MasterDb, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date().toISOString() })
    .where(eq(users.id, userId));
}

/** Clear any lock on an account (admin unlock / 2FA reset / password change). */
export async function clearLock(db: MasterDb, userId: string): Promise<void> {
  await recordSuccess(db, userId);
}
