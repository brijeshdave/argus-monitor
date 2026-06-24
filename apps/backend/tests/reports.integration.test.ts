/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Report preview: POST /api/reports/data returns the report document (for in-UI
 * preview + CSV/PDF/JSON export) without writing a file.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createEphemeralMasterDb, createEphemeralTelemetryDb, seedOwner, seedRbac } from "@argus/db";
import { buildApp } from "@/app.js";
import { loadConfig } from "@/config.js";

let app: FastifyInstance;
let token: string;
const OWNER = { username: "admin", password: "owner-pass-123" };
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  const master = await createEphemeralMasterDb();
  const telemetry = await createEphemeralTelemetryDb();
  await seedRbac(master.db);
  await seedOwner(master.db, OWNER);
  const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "error", JWT_SECRET: "test-secret" } as NodeJS.ProcessEnv);
  app = await buildApp({ config, connections: { master: master.db, telemetry: telemetry.db, close: async () => { await master.close(); await telemetry.close(); } } });
  await app.ready();
  token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: OWNER })).json().accessToken;
});

afterAll(async () => { await app.close(); });

describe("report preview", () => {
  it("builds an uptime report document without persisting a file", async () => {
    const res = await app.inject({ method: "POST", url: "/api/reports/data", headers: auth(token), payload: { type: "uptime", scope: { kind: "all" }, days: 7 } });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.type).toBe("uptime");
    expect(doc.days).toBe(7);
    expect(doc.data).toHaveProperty("overallPct");

    // No file written by preview.
    const list = await app.inject({ method: "GET", url: "/api/reports", headers: auth(token) });
    expect(list.json().rows.length).toBe(0);
  });

  it("rejects an unknown report type", async () => {
    const res = await app.inject({ method: "POST", url: "/api/reports/data", headers: auth(token), payload: { type: "nope", scope: { kind: "all" } } });
    expect(res.statusCode).toBe(400);
  });

  it("builds a summary report with KPI fields + charts data", async () => {
    const res = await app.inject({ method: "POST", url: "/api/reports/data", headers: auth(token), payload: { type: "summary", scope: { kind: "all" }, days: 30 } });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.type).toBe("summary");
    expect(doc.data).toHaveProperty("overallUptimePct");
    expect(doc.data).toHaveProperty("incidentCount");
    expect(Array.isArray(doc.data.uptimeTrend)).toBe(true);
    expect(Array.isArray(doc.data.incidentsPerDay)).toBe(true);
  });

  it("builds a resource (CPU/RAM) report with host + process series", async () => {
    const res = await app.inject({ method: "POST", url: "/api/reports/data", headers: auth(token), payload: { type: "resource", scope: { kind: "all" }, days: 30 } });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.type).toBe("resource");
    expect(Array.isArray(doc.data.hosts)).toBe(true);
    expect(Array.isArray(doc.data.processes)).toBe(true);
    expect(Array.isArray(doc.data.rows)).toBe(true);
  });

  it("builds a detailed storage report with a folders breakdown shape", async () => {
    const res = await app.inject({ method: "POST", url: "/api/reports/data", headers: auth(token), payload: { type: "storage-detail", scope: { kind: "all" }, days: 30 } });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.type).toBe("storage-detail");
    expect(Array.isArray(doc.data.monitors)).toBe(true);
  });

  it("honours an explicit custom date range and labels the window", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/reports/data", headers: auth(token),
      payload: { type: "uptime", scope: { kind: "all" }, from: "2026-01-01", to: "2026-01-31" },
    });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.from.slice(0, 10)).toBe("2026-01-01");
    expect(doc.to.slice(0, 10)).toBe("2026-01-31");
    expect(doc.windowLabel).toBe("2026-01-01 → 2026-01-31");
    expect(doc.scopeLabel).toBe("All monitors");
  });

  it("saves a snapshot, lists it with scope/window, then deletes it", async () => {
    const gen = await app.inject({ method: "POST", url: "/api/reports", headers: auth(token), payload: { type: "uptime", scope: { kind: "all" }, days: 7 } });
    expect(gen.statusCode).toBe(200);
    const name = gen.json().name as string;
    expect(gen.json().scopeLabel).toBe("All monitors");
    expect(gen.json().windowLabel).toBe("Last 7 days");

    const list = await app.inject({ method: "GET", url: "/api/reports", headers: auth(token) });
    expect(list.json().rows.some((r: { name: string }) => r.name === name)).toBe(true);

    const del = await app.inject({ method: "DELETE", url: `/api/reports/${encodeURIComponent(name)}`, headers: auth(token) });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/reports", headers: auth(token) });
    expect(after.json().rows.some((r: { name: string }) => r.name === name)).toBe(false);
  });
});
