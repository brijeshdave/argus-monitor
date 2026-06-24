/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Roundtrip test for the logical backup/restore. Exercises the real Postgres
 * dialect via PGlite: seed → export → import into fresh dbs → assert parity, and
 * confirm that importing REPLACES existing data (idempotent, no duplication).
 */
import { describe, expect, it } from "vitest";
import { exportDatabases, importDatabases } from "@/backup.js";
import { permissions, roles, users } from "@/master/schema.js";
import { logs, notifications } from "@/telemetry/schema.js";
import { seedRbac } from "@/seed/rbac.js";
import { createEphemeralMasterDb, createEphemeralTelemetryDb } from "@/testing.js";

describe("backup/restore roundtrip", () => {
  it("exports then imports into fresh databases with identical row counts", async () => {
    const src = await createEphemeralMasterDb();
    const srcTel = await createEphemeralTelemetryDb();

    // Seed RBAC into master + a few telemetry rows.
    await seedRbac(src.db);
    await src.db.insert(users).values({ username: "alice", displayName: "Alice" });
    await srcTel.db.insert(notifications).values({ severity: "info", title: "hello", message: "world" });
    await srcTel.db.insert(logs).values({ category: "system", level: "info", message: "boot" });

    const beforeUsers = (await src.db.select().from(users)).length;
    const beforeRoles = (await src.db.select().from(roles)).length;
    const beforePerms = (await src.db.select().from(permissions)).length;
    const beforeNotifs = (await srcTel.db.select().from(notifications)).length;
    const beforeLogs = (await srcTel.db.select().from(logs)).length;

    expect(beforeUsers).toBeGreaterThan(0);
    expect(beforeRoles).toBeGreaterThan(0);
    expect(beforePerms).toBeGreaterThan(0);

    const bundle = await exportDatabases(src.db, srcTel.db);
    expect(bundle.version).toBe(1);

    // Restore into FRESH, empty databases.
    const dst = await createEphemeralMasterDb();
    const dstTel = await createEphemeralTelemetryDb();
    await importDatabases(dst.db, dstTel.db, bundle);

    expect((await dst.db.select().from(users)).length).toBe(beforeUsers);
    expect((await dst.db.select().from(roles)).length).toBe(beforeRoles);
    expect((await dst.db.select().from(permissions)).length).toBe(beforePerms);
    expect((await dstTel.db.select().from(notifications)).length).toBe(beforeNotifs);
    expect((await dstTel.db.select().from(logs)).length).toBe(beforeLogs);

    await Promise.all([src.close(), srcTel.close(), dst.close(), dstTel.close()]);
  });

  it("replaces existing data on import (no duplication when run twice)", async () => {
    const src = await createEphemeralMasterDb();
    const srcTel = await createEphemeralTelemetryDb();
    await seedRbac(src.db);
    await srcTel.db.insert(notifications).values({ severity: "warning", title: "t", message: "m" });

    const bundle = await exportDatabases(src.db, srcTel.db);
    const expectedRoles = (await src.db.select().from(roles)).length;
    const expectedNotifs = (await srcTel.db.select().from(notifications)).length;

    const dst = await createEphemeralMasterDb();
    const dstTel = await createEphemeralTelemetryDb();

    await importDatabases(dst.db, dstTel.db, bundle);
    await importDatabases(dst.db, dstTel.db, bundle); // second import must be stable

    expect((await dst.db.select().from(roles)).length).toBe(expectedRoles);
    expect((await dstTel.db.select().from(notifications)).length).toBe(expectedNotifs);

    await Promise.all([src.close(), srcTel.close(), dst.close(), dstTel.close()]);
  });
});
