/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Resolves a user id into an AuthSubject: the effective permission set computed
 * across groups → roles → permissions (the ONLY path to access), plus ABAC
 * attributes and the owner flag. This is the single place that materialises a
 * subject for authorization.
 */
import { eq } from "drizzle-orm";
import {
  groupRoles, permissions, rolePermissions, userAttributes, userGroups, users,
  type MasterDb,
} from "@argus/db";
import type { AuthSubject } from "@argus/core";

/** A synthetic owner subject for the static ADMIN_TOKEN (automation/CLI). */
export const STATIC_ADMIN_SUBJECT: AuthSubject = {
  userId: "static-admin",
  isOwner: true,
  permissions: [],
  attributes: [],
};

/** Read-only capabilities a paired display device is granted (wallboard rendering). */
export const DEVICE_READ_PERMS = [
  "dashboard:read", "wallboards:read", "agents:read", "monitors:read", "notifications:read", "ticker:read",
];

/** A synthetic read-only subject for an approved display device (token auth). */
export function deviceSubject(deviceId: string): AuthSubject {
  return { userId: `device:${deviceId}`, isOwner: false, permissions: DEVICE_READ_PERMS, attributes: [] };
}

export async function resolveSubject(db: MasterDb, userId: string): Promise<AuthSubject | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.disabled) return null;

  // Effective permissions: user → groups → roles → permissions.
  const permRows = await db
    .select({ key: permissions.key })
    .from(userGroups)
    .innerJoin(groupRoles, eq(groupRoles.groupId, userGroups.groupId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, groupRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userGroups.userId, userId));

  const attrRows = await db
    .select({ key: userAttributes.key, value: userAttributes.value })
    .from(userAttributes)
    .where(eq(userAttributes.userId, userId));

  return {
    userId: user.id,
    isOwner: user.isOwner,
    permissions: [...new Set(permRows.map((r) => r.key))],
    attributes: attrRows,
  };
}
