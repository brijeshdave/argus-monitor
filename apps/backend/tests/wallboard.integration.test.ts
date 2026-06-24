/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Integration tests for the wallboard control plane: public device self-register +
 * status polling, owner approval (token shown once), ticker CRUD + "active now"
 * resolution, and wallboard layout create/clone/delete.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createEphemeralMasterDb, createEphemeralTelemetryDb, seedOwner, seedRbac } from "@argus/db";
import { buildApp } from "@/app.js";
import { loadConfig } from "@/config.js";

let app: FastifyInstance;
let ownerToken: string;
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

describe("device pairing (operator code → device claims)", () => {
  let pairingCode: string;

  it("operator creates a display with a 6-digit pairing code (shown in the UI)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/devices", headers: auth(ownerToken), payload: { name: "lobby-tv" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().device.status).toBe("pending");
    pairingCode = res.json().device.pairingCode;
    expect(pairingCode).toMatch(/^\d{6}$/);
  });

  it("rejects an unknown code with 404", async () => {
    const res = await app.inject({ method: "POST", url: "/api/devices/claim", payload: { code: "000000", fingerprint: "fp-x" } });
    expect(res.statusCode).toBe(404);
  });

  it("device claims the code → token returned once, device approved", async () => {
    const res = await app.inject({ method: "POST", url: "/api/devices/claim", payload: { code: pairingCode, fingerprint: "fp-lobby" } });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().token).toBe("string");
    expect(res.json().token.startsWith("wd_")).toBe(true);

    // The code is consumed — a second claim no longer matches a pending device.
    const again = await app.inject({ method: "POST", url: "/api/devices/claim", payload: { code: pairingCode, fingerprint: "fp-lobby" } });
    expect(again.statusCode).toBe(404);
  });

  it("a re-issued code claimed with the same fingerprint reuses the same device row", async () => {
    const before = await app.inject({ method: "GET", url: "/api/devices", headers: auth(ownerToken) });
    const countBefore = before.json().rows.length;

    const created = await app.inject({ method: "POST", url: "/api/devices", headers: auth(ownerToken), payload: { name: "lobby-tv-2" } });
    const code = created.json().device.pairingCode;
    const claim = await app.inject({ method: "POST", url: "/api/devices/claim", payload: { code, fingerprint: "fp-lobby" } });
    expect(claim.statusCode).toBe(200);

    // The placeholder is dropped + the original row reused → net device count unchanged.
    const after = await app.inject({ method: "GET", url: "/api/devices", headers: auth(ownerToken) });
    expect(after.json().rows.length).toBe(countBefore);
  });
});

describe("ticker", () => {
  it("creates an active (enabled, no window) message that appears in /active", async () => {
    const create = await app.inject({
      method: "POST", url: "/api/ticker", headers: auth(ownerToken),
      payload: { text: "All systems nominal", severity: "info", priority: 5 },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().message.id;

    const active = await app.inject({ method: "GET", url: "/api/ticker/active", headers: auth(ownerToken) });
    expect(active.statusCode).toBe(200);
    expect(active.json().rows.some((m: { id: string }) => m.id === id)).toBe(true);
  });

  it("excludes a disabled message from /active", async () => {
    const create = await app.inject({
      method: "POST", url: "/api/ticker", headers: auth(ownerToken),
      payload: { text: "Hidden", enabled: false },
    });
    const id = create.json().message.id;

    const active = await app.inject({ method: "GET", url: "/api/ticker/active", headers: auth(ownerToken) });
    expect(active.json().rows.some((m: { id: string }) => m.id === id)).toBe(false);
  });
});

describe("wallboards", () => {
  it("creates, clones (clone is non-default), and deletes the clone", async () => {
    const create = await app.inject({
      method: "POST", url: "/api/wallboards", headers: auth(ownerToken),
      payload: { name: "NOC", layout: { widgets: [] } },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().layout.id;

    const clone = await app.inject({
      method: "POST", url: `/api/wallboards/${id}/clone`, headers: auth(ownerToken),
      payload: { name: "NOC copy" },
    });
    expect(clone.statusCode).toBe(201);
    expect(clone.json().layout.isDefault).toBe(false);
    expect(clone.json().layout.isSystem).toBe(false);
    const cloneId = clone.json().layout.id;

    const del = await app.inject({ method: "DELETE", url: `/api/wallboards/${cloneId}`, headers: auth(ownerToken) });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);
  });
});
