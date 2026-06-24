/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Group management domain service. Groups are the bridge between users and roles —
 * a user gains permissions only through their group memberships. Protected (system)
 * groups cannot be mutated or deleted.
 */
import { eq, inArray } from "drizzle-orm";
import { groups, groupRoles, type MasterDb } from "@argus/db";
import { assertMutable } from "@argus/core";

export interface CreateGroupInput {
  name: string;
  description?: string;
  roleIds?: string[];
}

export interface UpdateGroupInput {
  name?: string;
  description?: string;
}

export async function listGroups(db: MasterDb) {
  const allGroups = await db.select().from(groups);
  const allGroupRoles = await db.select().from(groupRoles);

  return allGroups.map((group) => ({
    ...group,
    roleIds: allGroupRoles
      .filter((gr) => gr.groupId === group.id)
      .map((gr) => gr.roleId),
  }));
}

export async function getGroup(db: MasterDb, id: string) {
  const [row] = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
  return row;
}

export async function createGroup(db: MasterDb, input: CreateGroupInput) {
  const [created] = await db
    .insert(groups)
    .values({
      name: input.name,
      description: input.description ?? "",
    })
    .returning();
  if (created && input.roleIds?.length) {
    await setGroupRoles(db, created.id, input.roleIds);
  }
  return created;
}

export async function updateGroup(db: MasterDb, id: string, patch: UpdateGroupInput) {
  const existing = await getGroup(db, id);
  if (!existing) return undefined;
  assertMutable(existing, `Group "${existing.name}"`);

  const update: Partial<typeof groups.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;

  const [updated] = await db.update(groups).set(update).where(eq(groups.id, id)).returning();
  return updated;
}

export async function deleteGroup(db: MasterDb, id: string): Promise<boolean> {
  const existing = await getGroup(db, id);
  if (!existing) return false;
  assertMutable(existing, `Group "${existing.name}"`);
  await db.delete(groups).where(eq(groups.id, id));
  return true;
}

/** Replace the complete set of roles assigned to a group. */
export async function setGroupRoles(db: MasterDb, groupId: string, roleIds: string[]): Promise<void> {
  await db.delete(groupRoles).where(eq(groupRoles.groupId, groupId));
  if (roleIds.length) {
    await db
      .insert(groupRoles)
      .values(roleIds.map((roleId) => ({ groupId, roleId })))
      .onConflictDoNothing();
  }
}
