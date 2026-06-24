/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Integration tests for the public status page: an owner configures the page
 * (PUT /api/public/config) with one agent item, the UNAUTHENTICATED status
 * endpoint serves coarse fields only (no id/refId/hostname leaks), and a disabled
 * page returns 404.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createEphemeralMasterDb, createEphemeralTelemetryDb, seedOwner, seedRbac } from "@argus/db";
import { buildApp } from "@/app.js";
import { loadConfig } from "@/config.js";

let app: FastifyInstance;
let ownerToken: string;
let agentId: string;
const OWNER = { username: "admin", password: "owner-pass-123" };
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  const master = await createEphemeralMasterDb();
  const telemetry = await createEphemeralTelemetryDb();
  await seedRbac(master.db);
  await seedOwner(master.db, OWNER);
  const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "error", JWT_SECRET: "test-secret" } as NodeJS.ProcessEnv);
  app = await buildApp({
    config,
    connections: { master: master.db, telemetry: telemetry.db, close: async () => { await master.close(); await telemetry.close(); } },
  });
  await app.ready();
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: OWNER });
  ownerToken = login.json().accessToken;

  // Mint a key + register an agent so we have a real refId to pin.
  const keyRes = await app.inject({ method: "POST", url: "/api/agent-keys", headers: auth(ownerToken), payload: { label: "edge-1" } });
  const connectionKey = keyRes.json().key as string;
  const reg = await app.inject({
    method: "POST", url: "/api/agent/register",
    headers: { "x-argus-key": connectionKey },
    payload: { hostname: "host-a", platform: "linux", version: "1.0.0" },
  });
  agentId = reg.json().agentId;
  await app.inject({ method: "POST", url: `/api/agents/${agentId}/approve`, headers: auth(ownerToken) });
});

afterAll(async () => { await app.close(); });

describe("public status page", () => {
  it("returns 404 from the public endpoint while disabled (default)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/public/status" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("disabled");
  });

  it("lets the owner enable the page with one grouped agent item", async () => {
    const res = await app.inject({
      method: "PUT", url: "/api/public/config", headers: auth(ownerToken),
      payload: {
        enabled: true,
        title: "Acme Status",
        description: "Live status of our services.",
        showUptime: true,
        showHistory: true,
        historyDays: 90,
        notice: { level: "maintenance", message: "Upgrading storage 02:00–03:00 UTC." },
        items: [{ kind: "agent", refId: agentId, label: "Primary Host", group: "Core" }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().historyDays).toBe(90);
    expect(res.json().notice).toEqual({ level: "maintenance", message: "Upgrading storage 02:00–03:00 UTC." });
  });

  it("serves the public status WITHOUT auth, exposing only coarse fields", async () => {
    const res = await app.inject({ method: "GET", url: "/api/public/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe("Acme Status");
    expect(body.description).toBe("Live status of our services.");
    expect(body.notice).toEqual({ level: "maintenance", message: "Upgrading storage 02:00–03:00 UTC." });
    expect(Array.isArray(body.groups)).toBe(true);
    expect(body.groups).toHaveLength(1);
    expect(body.generatedAt).toBeTypeOf("string");

    const group = body.groups[0];
    expect(group.name).toBe("Core");
    expect(group.status).toBeTypeOf("string");
    expect(group.items).toHaveLength(1);

    const item = group.items[0];
    expect(item.label).toBe("Primary Host");
    expect(item.status).toBeTypeOf("string");
    // Secure-by-construction: no internal identifiers must leak.
    expect(item).not.toHaveProperty("id");
    expect(item).not.toHaveProperty("refId");
    expect(item).not.toHaveProperty("hostname");
    expect(item).not.toHaveProperty("kind");
    expect(item).not.toHaveProperty("group");
  });

  it("returns 404 again once disabled", async () => {
    const upd = await app.inject({
      method: "PUT", url: "/api/public/config", headers: auth(ownerToken),
      payload: { enabled: false, title: "Acme Status", showUptime: true, showHistory: true, historyDays: 90, items: [] },
    });
    expect(upd.statusCode).toBe(200);

    const res = await app.inject({ method: "GET", url: "/api/public/status" });
    expect(res.statusCode).toBe(404);
  });
});
