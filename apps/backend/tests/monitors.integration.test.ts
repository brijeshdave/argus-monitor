/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Integration tests for the monitors CRUD API. Uses the same ephemeral PGlite
 * harness as agent.integration.test.ts — in-memory DBs, a real Fastify app,
 * and the owner account for auth.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createEphemeralMasterDb, createEphemeralTelemetryDb, seedOwner, seedRbac } from "@argus/db";
import { buildApp } from "@/app.js";
import { loadConfig } from "@/config.js";

let app: FastifyInstance;
let ownerToken: string;
let agentId: string;
let monitorId: string;

const OWNER = { username: "admin", password: "owner-pass-123" };
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");

  const master = await createEphemeralMasterDb();
  const telemetry = await createEphemeralTelemetryDb();
  await seedRbac(master.db);
  await seedOwner(master.db, OWNER);

  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    JWT_SECRET: "test-secret",
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

  // Login as owner to obtain an access token.
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: OWNER,
  });
  ownerToken = login.json().accessToken;

  // Mint a connection key and register an agent so we have a valid agentId.
  const keyRes = await app.inject({
    method: "POST",
    url: "/api/agent-keys",
    headers: auth(ownerToken),
    payload: { label: "test-key" },
  });
  const { key: connectionKey } = keyRes.json<{ keyId: string; key: string }>();

  const regRes = await app.inject({
    method: "POST",
    url: "/api/agent/register",
    headers: { "x-argus-key": connectionKey },
    payload: { hostname: "test-host", platform: "linux", version: "1.0.0" },
  });
  agentId = regRes.json().agentId;
});

afterAll(async () => {
  await app.close();
});

describe("monitors CRUD", () => {
  it("creates a monitor (201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/monitors",
      headers: auth(ownerToken),
      payload: {
        agentId,
        type: "service",
        name: "nginx",
        enabled: true,
        config: { unit: "nginx.service" },
      },
    });
    expect(res.statusCode).toBe(201);
    const { monitor } = res.json<{ monitor: { id: string; name: string; enabled: boolean; type: string } }>();
    expect(monitor.name).toBe("nginx");
    expect(monitor.type).toBe("service");
    expect(monitor.enabled).toBe(true);
    monitorId = monitor.id;
  });

  it("rejects a create with an invalid type (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/monitors",
      headers: auth(ownerToken),
      payload: { agentId, type: "invalid_type", name: "bad" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists monitors and the new one is present", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/monitors",
      headers: auth(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const { rows } = res.json<{ rows: Array<{ id: string }> }>();
    expect(rows.some((m) => m.id === monitorId)).toBe(true);
  });

  it("filters list by agentId", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/monitors?agentId=${agentId}`,
      headers: auth(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const { rows } = res.json<{ rows: Array<{ agentId: string }> }>();
    expect(rows.every((m) => m.agentId === agentId)).toBe(true);
    expect(rows.some((m) => m.agentId === agentId)).toBe(true);
  });

  it("gets a single monitor by id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitorId}`,
      headers: auth(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().monitor.id).toBe(monitorId);
  });

  it("returns wallboard series shape for a monitor (empty until samples exist)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/monitors/series?ids=${monitorId}`,
      headers: auth(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().series[monitorId]).toEqual({ latency: [], uptimePct: null });
  });

  it("patches the monitor (enabled=false reflected)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/monitors/${monitorId}`,
      headers: auth(ownerToken),
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().monitor.enabled).toBe(false);
  });

  it("deletes the monitor (200 ok)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/monitors/${monitorId}`,
      headers: auth(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("returns 404 for deleted monitor", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/monitors/${monitorId}`,
      headers: auth(ownerToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when patching a non-existent monitor", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/monitors/00000000-0000-0000-0000-000000000000`,
      headers: auth(ownerToken),
      payload: { name: "ghost" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when deleting a non-existent monitor", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/monitors/00000000-0000-0000-0000-000000000000`,
      headers: auth(ownerToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/monitors" });
    expect(res.statusCode).toBe(401);
  });
});
