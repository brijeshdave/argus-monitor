/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Integration tests for the HTTP agent control plane: mint key → register →
 * approve → ingest, plus key-auth and approval gating.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LiveMessage } from "@argus/shared";
import type { FastifyInstance } from "fastify";
import { createEphemeralMasterDb, createEphemeralTelemetryDb, seedOwner, seedRbac } from "@argus/db";
import { buildApp } from "@/app.js";
import { loadConfig } from "@/config.js";

let app: FastifyInstance;
let ownerToken: string;
let connectionKey: string;
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
});

afterAll(async () => { await app.close(); });

describe("agent control plane (HTTP)", () => {
  it("mints a connection key (returned once)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/agent-keys", headers: auth(ownerToken), payload: { label: "edge-1" } });
    expect(res.statusCode).toBe(201);
    connectionKey = res.json().key;
    expect(connectionKey.startsWith("argus_")).toBe(true);
  });

  it("rejects an unknown key with 401", async () => {
    const res = await app.inject({ method: "POST", url: "/api/agent/register", headers: { "x-argus-key": "argus_nope" }, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("registers the agent as pending", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/agent/register",
      headers: { "x-argus-key": connectionKey },
      payload: { hostname: "host-a", platform: "linux", version: "1.0.0" },
    });
    expect(res.statusCode).toBe(200);
    agentId = res.json().agentId;
    expect(res.json().status).toBe("pending");
  });

  it("blocks ingest until approved (403)", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/agent/ingest",
      headers: { "x-argus-key": connectionKey },
      payload: { metrics: { cpuPct: 12 } },
    });
    expect(res.statusCode).toBe(403);
  });

  it("approves the agent then accepts ingest", async () => {
    const approve = await app.inject({ method: "POST", url: `/api/agents/${agentId}/approve`, headers: auth(ownerToken) });
    expect(approve.statusCode).toBe(200);

    const ingest = await app.inject({
      method: "POST", url: "/api/agent/ingest",
      headers: { "x-argus-key": connectionKey },
      payload: { metrics: { cpuPct: 25, memPct: 40 }, logs: [{ category: "agent", level: "info", message: "hello" }] },
    });
    expect(ingest.statusCode).toBe(200);
    expect(ingest.json().ok).toBe(true);
  });

  it("broadcasts ingested logs to operators as a live `log` message", async () => {
    const sent: LiveMessage[] = [];
    const spy = vi.spyOn(app.operatorHub, "broadcast").mockImplementation((msg) => { sent.push(msg); });
    try {
      const ingest = await app.inject({
        method: "POST", url: "/api/agent/ingest",
        headers: { "x-argus-key": connectionKey },
        payload: { logs: [{ category: "agent", level: "warn", message: "spooling" }] },
      });
      expect(ingest.statusCode).toBe(200);

      const log = sent.find((m): m is Extract<LiveMessage, { t: "log" }> => m.t === "log");
      expect(log).toBeDefined();
      expect(log?.agentId).toBe(agentId);
      expect(log?.lines).toEqual([
        expect.objectContaining({ level: "warn", message: "spooling", category: "agent" }),
      ]);
      expect(typeof log?.lines[0]?.ts).toBe("string");
    } finally {
      spy.mockRestore();
    }
  });

  it("auto-creates a default server-side ping on approval and hides it from the agent config", async () => {
    // A second agent that reports an address → default reachability ping on approve.
    const key = (await app.inject({ method: "POST", url: "/api/agent-keys", headers: auth(ownerToken), payload: { label: "edge-2" } })).json().key;
    const reg = await app.inject({
      method: "POST", url: "/api/agent/register",
      headers: { "x-argus-key": key },
      payload: { hostname: "host-b", platform: "linux", version: "1.0.0", address: "10.1.2.3" },
    });
    const id = reg.json().agentId;
    await app.inject({ method: "POST", url: `/api/agents/${id}/approve`, headers: auth(ownerToken) });

    const monitors = (await app.inject({ method: "GET", url: `/api/monitors?agentId=${id}`, headers: auth(ownerToken) })).json().rows;
    const ping = monitors.find((m: { type: string; config: Record<string, unknown> }) => m.type === "ping");
    expect(ping?.config).toMatchObject({ host: "10.1.2.3", server: true, default: true });

    // Approving again must not duplicate the default ping (idempotent).
    await app.inject({ method: "POST", url: `/api/agents/${id}/approve`, headers: auth(ownerToken) });
    const after = (await app.inject({ method: "GET", url: `/api/monitors?agentId=${id}`, headers: auth(ownerToken) })).json().rows;
    expect(after.filter((m: { type: string }) => m.type === "ping").length).toBe(1);

    // The agent must NOT be told to run the server-side ping itself.
    const cfg = await app.inject({ method: "GET", url: "/api/agent/config", headers: { "x-argus-key": key } });
    expect(cfg.json().monitors.some((m: { type: string }) => m.type === "ping")).toBe(false);
  });

  it("stores a pushed inventory and serves it to operators", async () => {
    const push = await app.inject({
      method: "POST", url: "/api/agent/inventory",
      headers: { "x-argus-key": connectionKey },
      payload: { services: [{ name: "nginx", detail: "web server" }], processes: [{ name: "node", detail: "/usr/bin/node" }] },
    });
    expect(push.statusCode).toBe(200);

    const read = await app.inject({ method: "GET", url: `/api/agents/${agentId}/inventory`, headers: auth(ownerToken) });
    expect(read.statusCode).toBe(200);
    expect(read.json().inventory.services).toEqual([{ name: "nginx", detail: "web server" }]);
    expect(read.json().inventory.processes[0]).toMatchObject({ name: "node" });
  });

  it("queues a restart command (pending while the agent is offline)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/agents/${agentId}/restart`, headers: auth(ownerToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().command.type).toBe("restart");
    expect(res.json().delivered).toBe(false); // no live control socket in this test

    const list = await app.inject({ method: "GET", url: `/api/agents/${agentId}/commands`, headers: auth(ownerToken) });
    expect(list.json().rows.some((c: { type: string; status: string }) => c.type === "restart" && c.status === "pending")).toBe(true);
  });
});
