/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * OIDC provider admin: create (with an encrypted, never-returned secret), list with
 * the derived redirect URI, enable via patch, then delete.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createEphemeralMasterDb, createEphemeralTelemetryDb, seedOwner, seedRbac } from "@argus/db";
import { buildApp } from "@/app.js";
import { loadConfig } from "@/config.js";

let app: FastifyInstance;
let ownerToken: string;
let providerId: string;
const OWNER = { username: "admin", password: "owner-pass-123" };
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const master = await createEphemeralMasterDb();
  const telemetry = await createEphemeralTelemetryDb();
  await seedRbac(master.db);
  await seedOwner(master.db, OWNER);
  const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "error", JWT_SECRET: "test-secret", PUBLIC_URL: "https://argus.example.com" } as NodeJS.ProcessEnv);
  app = await buildApp({
    config,
    connections: { master: master.db, telemetry: telemetry.db, close: async () => { await master.close(); await telemetry.close(); } },
  });
  await app.ready();
  ownerToken = (await app.inject({ method: "POST", url: "/api/auth/login", payload: OWNER })).json().accessToken;
});

afterAll(async () => { await app.close(); });

describe("OIDC provider admin", () => {
  it("creates a provider with a write-only secret", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/oidc-providers", headers: auth(ownerToken),
      payload: { name: "Entra", issuer: "https://login.example.com/v2.0", clientId: "abc123", clientSecret: "s3cr3t" },
    });
    expect(res.statusCode).toBe(201);
    const p = res.json().provider;
    providerId = p.id;
    expect(p.hasSecret).toBe(true);
    expect(p.clientSecret).toBeUndefined(); // never serialized
  });

  it("lists providers with a per-provider derived redirect URI", async () => {
    const res = await app.inject({ method: "GET", url: "/api/oidc-providers", headers: auth(ownerToken) });
    expect(res.statusCode).toBe(200);
    const row = res.json().rows.find((r: { id: string }) => r.id === providerId);
    expect(row).toBeTruthy();
    expect(row.redirectUri).toBe(`https://argus.example.com/api/auth/oidc/${providerId}/callback`);
    expect(row.brand).toBe("generic");
  });

  it("enables the provider via patch + lists it as a public login option", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/oidc-providers/${providerId}`, headers: auth(ownerToken), payload: { enabled: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().provider.enabled).toBe(true);

    // Unauthenticated login page can now discover this enabled provider.
    const pub = await app.inject({ method: "GET", url: "/api/auth/oidc/providers" });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().providers.some((p: { id: string; loginUrl: string }) => p.id === providerId && p.loginUrl === `/api/auth/oidc/${providerId}/login`)).toBe(true);
  });

  it("deletes the provider", async () => {
    expect((await app.inject({ method: "DELETE", url: `/api/oidc-providers/${providerId}`, headers: auth(ownerToken) })).statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/oidc-providers", headers: auth(ownerToken) });
    expect(list.json().rows.length).toBe(0);
  });
});
