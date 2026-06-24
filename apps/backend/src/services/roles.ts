/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Role management domain service. Roles are named capability bundles that a group
 * carries. System roles (superadmin, admin, operator, viewer) are seeded and
 * immutable — they cannot be edited or deleted.
 */
import { eq, inArray } from "drizzle-orm";
import { roles, rolePermissions, permissions, type MasterDb } from "@argus/db";
import { assertMutable } from "@argus/core";

export interface CreateRoleInput {
  name: string;
  description?: string;
  permissionKeys?: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
}

export async function listRoles(db: MasterDb) {
  const allRoles = await db.select().from(roles);
  const allRolePermissions = await db.select().from(rolePermissions);
  const allPermissions = allRolePermissions.length
    ? await db
        .select()
        .from(permissions)
        .where(inArray(permissions.id, allRolePermissions.map((rp) => rp.permissionId)))
    : [];

  const permById = new Map(allPermissions.map((p) => [p.id, p.key]));

  return allRoles.map((role) => ({
    ...role,
    permissions: allRolePermissions
      .filter((rp) => rp.roleId === role.id)
      .map((rp) => permById.get(rp.permissionId))
      .filter((key): key is string => key !== undefined),
  }));
}

export async function getRole(db: MasterDb, id: string) {
  const [row] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  return row;
}

/** The permission keys currently granted to a role (sorted) — used for audit diffs. */
export async function getRolePermissionKeys(db: MasterDb, roleId: string): Promise<string[]> {
  const rows = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, roleId));
  return rows.map((r) => r.key).sort();
}

export async function createRole(db: MasterDb, input: CreateRoleInput) {
  const [created] = await db
    .insert(roles)
    .values({
      name: input.name,
      description: input.description ?? "",
    })
    .returning();
  if (created && input.permissionKeys?.length) {
    await setRolePermissions(db, created.id, input.permissionKeys);
  }
  return created;
}

export async function updateRole(db: MasterDb, id: string, patch: UpdateRoleInput) {
  const existing = await getRole(db, id);
  if (!existing) return undefined;
  assertMutable(existing, `Role "${existing.name}"`);

  const update: Partial<typeof roles.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;

  const [updated] = await db.update(roles).set(update).where(eq(roles.id, id)).returning();
  return updated;
}

export async function deleteRole(db: MasterDb, id: string): Promise<boolean> {
  const existing = await getRole(db, id);
  if (!existing) return false;
  assertMutable(existing, `Role "${existing.name}"`);
  await db.delete(roles).where(eq(roles.id, id));
  return true;
}

/**
 * Replace the complete set of permissions on a role. Unknown keys are silently
 * ignored so callers can use the catalogue as-is without pre-filtering.
 */
export async function setRolePermissions(db: MasterDb, roleId: string, permissionKeys: string[]): Promise<void> {
  // Resolve keys → ids; unknown keys produce no rows (silently dropped).
  const resolved = permissionKeys.length
    ? await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(inArray(permissions.key, permissionKeys))
    : [];

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (resolved.length) {
    await db
      .insert(rolePermissions)
      .values(resolved.map(({ id: permissionId }) => ({ roleId, permissionId })))
      .onConflictDoNothing();
  }
}
