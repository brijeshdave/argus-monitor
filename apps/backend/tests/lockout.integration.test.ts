/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Integration tests for per-account login lockout: after N consecutive failed
 * local logins the account locks (423) for a cooldown, a correct password is
 * rejected while locked, and an admin unlock restores access. Runs against the
 * real app graph on in-memory PGlite databases via fastify.inject.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createEphemeralMasterDb, createEphemeralTelemetryDb, seedOwner, seedRbac } from "@argus/db";
import { buildApp } from "@/app.js";
import { loadConfig } from "@/config.js";

let app: FastifyInstance;
let ownerToken: string;
const OWNER = { username: "admin", password: "owner-pass-123" };
const VICTIM = { username: "locky", password: "locky-pass-123" };

const authHeader = (token: string) => ({ authorization: `Bearer ${token}` });

const login = (username: string, password: string) =>
  app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });

beforeAll(async () => {
  const master = await createEphemeralMasterDb();
  const telemetry = await createEphemeralTelemetryDb();
  await seedRbac(master.db);
  await seedOwner(master.db, OWNER);

  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    JWT_SECRET: "test-secret",
    ADMIN_TOKEN: "static-admin-token",
  } as NodeJS.ProcessEnv);
  app = await buildApp({
    config,
    connections: {
      master: master.db,
      telemetry: telemetry.db,
      close: async () => {
        await master.close();
        await telemetry.close();
      },
    },
  });
  await app.ready();

  ownerToken = (await login(OWNER.username, OWNER.password)).json().accessToken;

  // Lower the threshold for a fast test, then create the victim user.
  await app.inject({
    method: "PUT",
    url: "/api/settings/security.lockout",
    headers: authHeader(ownerToken),
    payload: { value: { maxAttempts: 3, windowMinutes: 15 } },
  });
  const created = await app.inject({
    method: "POST",
    url: "/api/users",
    headers: authHeader(ownerToken),
    payload: { username: VICTIM.username, password: VICTIM.password },
  });
  expect(created.statusCode).toBe(201);
});

afterAll(async () => {
  await app.close();
});

describe("per-account login lockout", () => {
  it("locks the account after N consecutive failures and clears on admin unlock", async () => {
    // Sanity: correct password works before any failures.
    expect((await login(VICTIM.username, VICTIM.password)).statusCode).toBe(200);

    // 3 wrong passwords (maxAttempts) trips the lock.
    for (let i = 0; i < 3; i++) {
      const res = await login(VICTIM.username, "wrong-pass");
      expect(res.statusCode).toBe(401);
    }

    // Now even the CORRECT password is refused with 423 while locked.
    const blocked = await login(VICTIM.username, VICTIM.password);
    expect(blocked.statusCode).toBe(423);
    expect(blocked.json().error).toBe("account_locked");
    expect(blocked.json().until).toBeTruthy();

    // The admin UI sees the account as locked.
    const rows = (await app.inject({ method: "GET", url: "/api/users", headers: authHeader(ownerToken) })).json().rows;
    const victimRow = rows.find((u: { username: string }) => u.username === VICTIM.username);
    expect(victimRow.locked).toBe(true);

    // Admin unlocks the account.
    const unlock = await app.inject({
      method: "POST",
      url: `/api/users/${victimRow.id}/unlock`,
      headers: authHeader(ownerToken),
    });
    expect(unlock.statusCode).toBe(200);

    // Login works again immediately.
    expect((await login(VICTIM.username, VICTIM.password)).statusCode).toBe(200);
  });

  it("resets the failure counter on a successful login (no lock from spread-out failures)", async () => {
    // Two failures, then a success, then two more failures — never 3 consecutive.
    await login(VICTIM.username, "wrong-pass");
    await login(VICTIM.username, "wrong-pass");
    expect((await login(VICTIM.username, VICTIM.password)).statusCode).toBe(200);
    await login(VICTIM.username, "wrong-pass");
    await login(VICTIM.username, "wrong-pass");
    // Still not locked — the success reset the counter.
    expect((await login(VICTIM.username, VICTIM.password)).statusCode).toBe(200);
  });
});
