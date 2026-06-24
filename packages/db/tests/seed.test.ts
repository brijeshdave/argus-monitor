/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Data-layer tests for the seed: RBAC catalogue correctness, idempotency, the
 * group-only access rule, and the immutable owner bootstrap.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { ALL_PERMISSIONS, SYSTEM_GROUPS, SYSTEM_ROLES } from "@argus/shared";
import { createEphemeralMasterDb } from "@/testing.js";
import { seedRbac } from "@/seed/rbac.js";
import { seedOwner } from "@/seed/owner.js";
import { seedRetentionDefaults, RETENTION_DATA_TYPES } from "@/seed/retention.js";
import {
  groupRoles, groups, permissions, rolePermissions, roles, userGroups, users, retentionConfig,
} from "@/master/schema.js";
import type { MasterDb } from "@/master/index.js";

let db: MasterDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createEphemeralMasterDb());
});
afterEach(async () => {
  await close();
});

describe("seedRbac", () => {
  it("seeds the full permission catalogue, system roles and default groups", async () => {
    await seedRbac(db);
    expect((await db.select().from(permissions)).length).toBe(ALL_PERMISSIONS.length);
    expect((await db.select().from(roles)).length).toBe(SYSTEM_ROLES.length);
    expect((await db.select().from(groups)).length).toBe(SYSTEM_GROUPS.length);
    // System roles are flagged immutable.
    expect((await db.select().from(roles)).every((r) => r.isSystem)).toBe(true);
  });

  it("grants superadmin every permission and viewer strictly fewer", async () => {
    await seedRbac(db);
    const [superadmin] = await db.select().from(roles).where(eq(roles.name, "superadmin"));
    const [viewer] = await db.select().from(roles).where(eq(roles.name, "viewer"));
    const superPerms = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, superadmin!.id));
    const viewerPerms = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, viewer!.id));
    expect(superPerms.length).toBe(ALL_PERMISSIONS.length);
    expect(viewerPerms.length).toBeLessThan(superPerms.length);
    expect(viewerPerms.length).toBeGreaterThan(0);
  });

  it("maps each default group to a role (group→role edges exist)", async () => {
    await seedRbac(db);
    expect((await db.select().from(groupRoles)).length).toBe(SYSTEM_GROUPS.length);
  });

  it("is idempotent (running twice does not duplicate rows)", async () => {
    await seedRbac(db);
    await seedRbac(db);
    expect((await db.select().from(permissions)).length).toBe(ALL_PERMISSIONS.length);
    expect((await db.select().from(roles)).length).toBe(SYSTEM_ROLES.length);
    expect((await db.select().from(groups)).length).toBe(SYSTEM_GROUPS.length);
    expect((await db.select().from(groupRoles)).length).toBe(SYSTEM_GROUPS.length);
  });
});

describe("seedOwner", () => {
  it("creates a protected owner placed in the Owners group (access via groups only)", async () => {
    await seedRbac(db);
    const result = await seedOwner(db, { password: "s3cret-pw" });
    expect(result.created).toBe(true);

    const [owner] = await db.select().from(users).where(eq(users.isOwner, true));
    expect(owner).toBeDefined();
    expect(owner!.isSystem).toBe(true);
    expect(owner!.passwordHash).toBeTruthy();

    const memberships = await db.select().from(userGroups).where(eq(userGroups.userId, owner!.id));
    expect(memberships.length).toBe(1);
    const [ownersGroup] = await db.select().from(groups).where(eq(groups.name, "Owners"));
    expect(memberships[0]!.groupId).toBe(ownersGroup!.id);
  });

  it("is idempotent (second run does not create another owner)", async () => {
    await seedRbac(db);
    await seedOwner(db, { password: "pw1" });
    const second = await seedOwner(db, { password: "pw2" });
    expect(second.created).toBe(false);
    expect((await db.select().from(users).where(eq(users.isOwner, true))).length).toBe(1);
  });

  it("generates a password when none is supplied", async () => {
    await seedRbac(db);
    const result = await seedOwner(db, {});
    expect(result.created).toBe(true);
    expect(result.generatedPassword).toBeTruthy();
  });
});

describe("seedRetentionDefaults", () => {
  it("seeds every data type as unlimited (null) by default", async () => {
    await seedRetentionDefaults(db);
    const rows = await db.select().from(retentionConfig);
    expect(rows.length).toBe(RETENTION_DATA_TYPES.length);
    expect(rows.every((r) => r.days === null)).toBe(true);
  });
});
