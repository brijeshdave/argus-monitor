/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Seeds the RBAC catalogue: permissions, system roles, default groups and their
 * mappings. Idempotent (safe to run on every boot) via ON CONFLICT DO NOTHING.
 * The catalogue itself lives in @argus/shared so there is one source of truth.
 */
import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  SYSTEM_GROUPS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_PERMISSIONS,
  type Permission,
} from "@argus/shared";
import { notInArray, sql } from "drizzle-orm";
import type { MasterDb } from "@/master/index.js";
import { groupRoles, groups, permissions, rolePermissions, roles } from "@/master/schema.js";

export async function seedRbac(db: MasterDb): Promise<void> {
  // 1) Permissions — the atomic capabilities. The catalogue in @argus/shared is
  // authoritative: upsert keys + friendly descriptions, then prune any rows that
  // are no longer in the catalogue so retiring a permission self-heals the DB
  // (role_permissions rows cascade-delete with the permission).
  await db
    .insert(permissions)
    .values(ALL_PERMISSIONS.map((key) => ({ key, description: PERMISSION_DESCRIPTIONS[key] ?? "" })))
    .onConflictDoUpdate({ target: permissions.key, set: { description: sql`excluded.description` } });

  await db.delete(permissions).where(notInArray(permissions.key, ALL_PERMISSIONS));

  // 2) System roles — immutable, seeded.
  await db
    .insert(roles)
    .values(SYSTEM_ROLES.map((name) => ({ name, description: `${name} (system role)`, isSystem: true })))
    .onConflictDoNothing({ target: roles.name });

  // 3) Default groups — each mapped to one system role.
  await db
    .insert(groups)
    .values(SYSTEM_GROUPS.map((g) => ({ name: g.name, description: g.description, isSystem: true })))
    .onConflictDoNothing({ target: groups.name });

  // Resolve ids once (avoids per-row round trips).
  const permRows = await db.select({ id: permissions.id, key: permissions.key }).from(permissions);
  const roleRows = await db.select({ id: roles.id, name: roles.name }).from(roles);
  const groupRows = await db.select({ id: groups.id, name: groups.name }).from(groups);

  const permId = new Map(permRows.map((p) => [p.key, p.id]));
  const roleId = new Map(roleRows.map((r) => [r.name, r.id]));
  const groupId = new Map(groupRows.map((g) => [g.name, g.id]));

  // 4) role → permission grants. "*" expands to every permission (superadmin).
  const grants: Array<{ roleId: string; permissionId: string }> = [];
  for (const role of SYSTEM_ROLES) {
    const spec = SYSTEM_ROLE_PERMISSIONS[role];
    const keys: Permission[] = spec === "*" ? ALL_PERMISSIONS : spec;
    const rid = roleId.get(role);
    if (!rid) continue;
    for (const key of keys) {
      const pid = permId.get(key);
      if (pid) grants.push({ roleId: rid, permissionId: pid });
    }
  }
  if (grants.length) {
    await db
      .insert(rolePermissions)
      .values(grants)
      .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.permissionId] });
  }

  // 5) group → role assignments.
  const groupRoleRows: Array<{ groupId: string; roleId: string }> = [];
  for (const g of SYSTEM_GROUPS) {
    const gid = groupId.get(g.name);
    const rid = roleId.get(g.role);
    if (gid && rid) groupRoleRows.push({ groupId: gid, roleId: rid });
  }
  if (groupRoleRows.length) {
    await db
      .insert(groupRoles)
      .values(groupRoleRows)
      .onConflictDoNothing({ target: [groupRoles.groupId, groupRoles.roleId] });
  }
}
