/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Client-metadata CRUD: upsert a per-IP custom name + description, list it, then
 * delete it.
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
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
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

describe("client metadata", () => {
  it("upserts, lists, then deletes a per-IP annotation", async () => {
    const put = await app.inject({ method: "PUT", url: "/api/client-meta/10.0.0.9", headers: auth(token), payload: { hostname: "HMI-Line-3", description: "Packing HMI" } });
    expect(put.statusCode).toBe(200);
    expect(put.json().meta).toMatchObject({ ip: "10.0.0.9", hostname: "HMI-Line-3", description: "Packing HMI" });

    const list = await app.inject({ method: "GET", url: "/api/client-meta", headers: auth(token) });
    expect(list.json().rows.find((r: { ip: string }) => r.ip === "10.0.0.9")?.hostname).toBe("HMI-Line-3");

    expect((await app.inject({ method: "DELETE", url: "/api/client-meta/10.0.0.9", headers: auth(token) })).statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/client-meta", headers: auth(token) });
    expect(after.json().rows.length).toBe(0);
  });
});
