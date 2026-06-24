/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Seeds the protected owner account — the first, immutable superadmin. It is
 * created exactly once (idempotent: skipped if any owner already exists) and is
 * placed in the "Owners" group, since access flows ONLY through groups. The
 * account is flagged is_owner + is_system so it can never be edited/deleted/
 * demoted via the API.
 */
import { randomBytes } from "node:crypto";
import { hashPassword } from "@argus/core";
import { eq } from "drizzle-orm";
import type { MasterDb } from "@/master/index.js";
import { groups, userGroups, users } from "@/master/schema.js";

export interface SeedOwnerOptions {
  username?: string;
  /** Plaintext password; when omitted a strong one is generated and returned. */
  password?: string;
}

export interface SeedOwnerResult {
  created: boolean;
  username: string;
  /** Set only when a password was auto-generated (so the operator can capture it). */
  generatedPassword?: string;
}

export async function seedOwner(db: MasterDb, opts: SeedOwnerOptions = {}): Promise<SeedOwnerResult> {
  const username = opts.username ?? "admin";

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.isOwner, true)).limit(1);
  if (existing.length > 0) return { created: false, username };

  const generated = opts.password ? undefined : randomBytes(12).toString("base64url");
  const password = opts.password ?? generated!;

  const [owner] = await db
    .insert(users)
    .values({
      username,
      displayName: "Owner",
      authProvider: "local",
      passwordHash: hashPassword(password),
      isOwner: true,
      isSystem: true,
      disabled: false,
    })
    .returning({ id: users.id });

  // Place the owner in the Owners group (the only path to the superadmin role).
  const [ownersGroup] = await db.select({ id: groups.id }).from(groups).where(eq(groups.name, "Owners")).limit(1);
  if (owner && ownersGroup) {
    await db
      .insert(userGroups)
      .values({ userId: owner.id, groupId: ownersGroup.id })
      .onConflictDoNothing({ target: [userGroups.userId, userGroups.groupId] });
  }

  return { created: true, username, ...(generated ? { generatedPassword: generated } : {}) };
}
