/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * User management domain service. Access is granted ONLY via group membership, so
 * creating/updating a user is really about its profile + group assignments — never
 * direct roles/permissions. Protected (owner/system) users cannot be mutated.
 */
import { eq } from "drizzle-orm";
import { userAttributes, userGroups, users, type MasterDb } from "@argus/db";
import { assertMutable, hashPassword } from "@argus/core";
import type { Attribute } from "@argus/shared";
import { toPublicUser, type AuthUser } from "@/services/auth.js";
import { isLocked } from "@/services/lockout.js";

/** Public user shape augmented with a computed `locked` flag, group memberships
 * and ABAC attributes (so the admin editor can prefill in a single round trip). */
export type ListedUser = ReturnType<typeof toPublicUser> & {
  locked: boolean;
  groupIds: string[];
  attributes: Attribute[];
};

export interface CreateUserInput {
  username: string;
  displayName?: string;
  email?: string | null;
  password: string;
  groupIds?: string[];
  attributes?: Attribute[];
}

export interface UpdateUserInput {
  displayName?: string;
  email?: string | null;
  disabled?: boolean;
  password?: string;
}

export async function listUsers(db: MasterDb): Promise<ListedUser[]> {
  const rows = await db.select().from(users);
  // One query for every membership edge, then bucket by user (avoids N+1).
  const memberships = await db.select({ userId: userGroups.userId, groupId: userGroups.groupId }).from(userGroups);
  const byUser = new Map<string, string[]>();
  for (const m of memberships) {
    const list = byUser.get(m.userId);
    if (list) list.push(m.groupId);
    else byUser.set(m.userId, [m.groupId]);
  }
  // Same one-shot bucketing for ABAC attributes.
  const attrRows = await db.select({ userId: userAttributes.userId, key: userAttributes.key, value: userAttributes.value }).from(userAttributes);
  const attrsByUser = new Map<string, Attribute[]>();
  for (const a of attrRows) {
    const list = attrsByUser.get(a.userId);
    if (list) list.push({ key: a.key, value: a.value });
    else attrsByUser.set(a.userId, [{ key: a.key, value: a.value }]);
  }
  // Surface a computed `locked` flag so the admin UI can show/unlock locked accounts.
  return rows.map((row) => ({
    ...toPublicUser(row),
    locked: isLocked(row),
    groupIds: byUser.get(row.id) ?? [],
    attributes: attrsByUser.get(row.id) ?? [],
  }));
}

export async function getUser(db: MasterDb, id: string): Promise<AuthUser | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

export async function createUser(db: MasterDb, input: CreateUserInput) {
  const [created] = await db
    .insert(users)
    .values({
      username: input.username,
      displayName: input.displayName ?? input.username,
      email: input.email ?? null,
      authProvider: "local",
      passwordHash: hashPassword(input.password),
    })
    .returning();
  if (created && input.groupIds?.length) {
    await setUserGroups(db, created.id, input.groupIds);
  }
  if (created && input.attributes?.length) {
    await setUserAttributes(db, created.id, input.attributes);
  }
  return created ? toPublicUser(created) : undefined;
}

export async function updateUser(db: MasterDb, id: string, patch: UpdateUserInput) {
  const existing = await getUser(db, id);
  if (!existing) return undefined;
  assertMutable(existing, `User "${existing.username}"`); // owner/system are immutable

  const update: Partial<typeof users.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.displayName !== undefined) update.displayName = patch.displayName;
  if (patch.email !== undefined) update.email = patch.email;
  if (patch.disabled !== undefined) update.disabled = patch.disabled;
  if (patch.password) update.passwordHash = hashPassword(patch.password);

  const [updated] = await db.update(users).set(update).where(eq(users.id, id)).returning();
  return updated ? toPublicUser(updated) : undefined;
}

export async function deleteUser(db: MasterDb, id: string): Promise<boolean> {
  const existing = await getUser(db, id);
  if (!existing) return false;
  assertMutable(existing, `User "${existing.username}"`);
  await db.delete(users).where(eq(users.id, id));
  return true;
}

/** Replace a user's group memberships (the only way to grant/revoke access). */
export async function setUserGroups(db: MasterDb, userId: string, groupIds: string[]): Promise<void> {
  await db.delete(userGroups).where(eq(userGroups.userId, userId));
  if (groupIds.length) {
    await db.insert(userGroups).values(groupIds.map((groupId) => ({ userId, groupId }))).onConflictDoNothing();
  }
}

/** Replace a user's ABAC attributes (key/value pairs that refine RBAC scope).
 * Blank keys are dropped and keys are de-duplicated (last value wins). */
export async function setUserAttributes(db: MasterDb, userId: string, attributes: Attribute[]): Promise<void> {
  const cleaned = new Map<string, string>();
  for (const a of attributes) {
    const key = a.key.trim();
    if (key) cleaned.set(key, a.value.trim());
  }
  await db.delete(userAttributes).where(eq(userAttributes.userId, userId));
  if (cleaned.size) {
    await db.insert(userAttributes).values([...cleaned].map(([key, value]) => ({ userId, key, value })));
  }
}
