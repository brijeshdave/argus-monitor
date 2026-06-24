/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Integration tests: boot the real app graph against in-memory PGlite databases
 * and exercise login, identity, RBAC enforcement, protected-entity rules and
 * refresh-token rotation end-to-end via fastify.inject (no network/listen).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createEphemeralMasterDb, createEphemeralTelemetryDb, seedOwner, seedRbac } from "@argus/db";
import { buildApp } from "@/app.js";
import { loadConfig } from "@/config.js";

let app: FastifyInstance;
const OWNER = { username: "admin", password: "owner-pass-123" };

const authHeader = (token: string) => ({ authorization: `Bearer ${token}` });

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
});

afterAll(async () => {
  await app.close();
});

async function login(username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  return { status: res.statusCode, body: res.json() };
}

describe("authentication", () => {
  it("rejects bad credentials with 401", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "wrong" } });
    expect(res.statusCode).toBe(401);
  });

  it("logs in the owner and never leaks the password hash", async () => {
    const { status, body } = await login(OWNER.username, OWNER.password);
    expect(status).toBe(200);
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user.passwordHash).toBeUndefined();
  });

  it("returns identity + owner flag from /api/me", async () => {
    const { body } = await login(OWNER.username, OWNER.password);
    const res = await app.inject({ method: "GET", url: "/api/me", headers: authHeader(body.accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().isOwner).toBe(true);
  });
});

describe("authorization (RBAC)", () => {
  it("rejects unauthenticated access with 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/users" });
    expect(res.statusCode).toBe(401);
  });

  it("allows the owner to list users (owner bypass)", async () => {
    const { body } = await login(OWNER.username, OWNER.password);
    const res = await app.inject({ method: "GET", url: "/api/users", headers: authHeader(body.accessToken) });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().rows)).toBe(true);
  });

  it("denies a viewer (no users:read) with 403", async () => {
    const owner = (await login(OWNER.username, OWNER.password)).body;

    // Find the seeded "Viewers" group.
    const groups = (await app.inject({ method: "GET", url: "/api/groups", headers: authHeader(owner.accessToken) })).json().rows;
    const viewers = groups.find((g: { name: string }) => g.name === "Viewers");
    expect(viewers).toBeTruthy();

    // Create a viewer user in that group.
    const created = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: authHeader(owner.accessToken),
      payload: { username: "vic", password: "viewer-pass-1", groupIds: [viewers.id] },
    });
    expect(created.statusCode).toBe(201);

    // Viewer logs in and is denied users:read.
    const viewer = (await login("vic", "viewer-pass-1")).body;
    const res = await app.inject({ method: "GET", url: "/api/users", headers: authHeader(viewer.accessToken) });
    expect(res.statusCode).toBe(403);
    expect(res.json().reason).toBe("missing_permission");
  });
});

describe("protected entities", () => {
  it("refuses to delete the immutable owner with 403", async () => {
    const owner = (await login(OWNER.username, OWNER.password)).body;
    const rows = (await app.inject({ method: "GET", url: "/api/users", headers: authHeader(owner.accessToken) })).json().rows;
    const ownerRow = rows.find((u: { isOwner: boolean }) => u.isOwner);
    const res = await app.inject({ method: "DELETE", url: `/api/users/${ownerRow.id}`, headers: authHeader(owner.accessToken) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("protected_entity");
  });
});

describe("refresh-token rotation", () => {
  it("rotates on refresh and rejects reuse of the old token", async () => {
    const { refreshToken } = (await login(OWNER.username, OWNER.password)).body;

    const first = await app.inject({ method: "POST", url: "/api/auth/refresh", payload: { refreshToken } });
    expect(first.statusCode).toBe(200);
    expect(first.json().refreshToken).not.toBe(refreshToken);

    // Reusing the now-rotated (revoked) token must fail.
    const reuse = await app.inject({ method: "POST", url: "/api/auth/refresh", payload: { refreshToken } });
    expect(reuse.statusCode).toBe(401);
  });
});

describe("instant revocation", () => {
  it("kills an access token the instant its own session is terminated", async () => {
    const { accessToken } = (await login(OWNER.username, OWNER.password)).body;

    // Token works.
    const before = await app.inject({ method: "GET", url: "/api/me", headers: authHeader(accessToken) });
    expect(before.statusCode).toBe(200);

    // Terminate this token's own session (its `sid` refresh row).
    const sessions = (await app.inject({ method: "GET", url: "/api/me/sessions", headers: authHeader(accessToken) })).json().rows;
    expect(sessions.length).toBeGreaterThan(0);
    const sid = sessions[0].id as string;
    const del = await app.inject({ method: "DELETE", url: `/api/me/sessions/${sid}`, headers: authHeader(accessToken) });
    expect(del.statusCode).toBe(200);

    // The SAME access token is now dead — no waiting for expiry.
    const after = await app.inject({ method: "GET", url: "/api/me", headers: authHeader(accessToken) });
    expect(after.statusCode).toBe(401);
    expect(after.json().error).toBe("session_revoked");
  });

  it("leaves the static admin token unaffected (no sid/tv claims)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me", headers: authHeader("static-admin-token") });
    expect(res.statusCode).toBe(200);
    expect(res.json().isOwner).toBe(true);
  });

  it("kills ALL access tokens the instant the password changes (token version bump)", async () => {
    const { accessToken } = (await login(OWNER.username, OWNER.password)).body;
    expect((await app.inject({ method: "GET", url: "/api/me", headers: authHeader(accessToken) })).statusCode).toBe(200);

    // Change the password (revokes sessions + bumps tokenVersion). Reset it back
    // so the shared OWNER credentials keep working for later tests.
    const changed = await app.inject({
      method: "POST",
      url: "/api/me/password",
      headers: authHeader(accessToken),
      payload: { currentPassword: OWNER.password, newPassword: "owner-pass-456" },
    });
    expect(changed.statusCode).toBe(200);

    // The pre-change access token is dead via token-version mismatch (not just sid).
    const after = await app.inject({ method: "GET", url: "/api/me", headers: authHeader(accessToken) });
    expect(after.statusCode).toBe(401);
    expect(after.json().error).toBe("token_revoked");

    // Restore the original password using a fresh session.
    const fresh = (await login(OWNER.username, "owner-pass-456")).body;
    const restored = await app.inject({
      method: "POST",
      url: "/api/me/password",
      headers: authHeader(fresh.accessToken),
      payload: { currentPassword: "owner-pass-456", newPassword: OWNER.password },
    });
    expect(restored.statusCode).toBe(200);
  });
});
