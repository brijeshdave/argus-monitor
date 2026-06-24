/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * OIDC login routes. Supports MULTIPLE enabled providers, each with its own
 * PKCE auth-code flow at /api/auth/oidc/:id/{login,callback}. A legacy single
 * env-configured provider is kept at /api/auth/oidc/{login,callback}. The
 * unauthenticated /api/auth/oidc/providers lists enabled providers for the login UI.
 *
 * PKCE verifiers are held briefly in-memory keyed by state; for multi-instance
 * deployments this moves to Redis (ADR-0005) — noted for a later phase.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { issueRefreshToken } from "@/services/auth.js";
import { OIDC_BRANDS } from "@argus/shared";
import { buildAuthUrl, discover, exchangeCode, findOrProvisionUser, pkcePair, type OidcConfig } from "@/services/oidc.js";
import {
  createOidcProvider, deleteOidcProvider, getProviderConfig, listEnabledPublicProviders,
  listOidcProviders, updateOidcProvider,
} from "@/services/oidc-providers.js";

interface PendingState {
  verifier: string;
  expiresAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;

export async function oidcRoutes(app: FastifyInstance): Promise<void> {
  const pending = new Map<string, PendingState>();

  /** Legacy env-configured provider (used only when no DB provider matches). */
  const envConfig = (): OidcConfig | null => {
    const c = app.config;
    if (!c.oidcEnabled || !c.oidcIssuer || !c.oidcClientId || !c.oidcClientSecret || !c.oidcRedirectUri) return null;
    return { issuer: c.oidcIssuer, clientId: c.oidcClientId, clientSecret: c.oidcClientSecret, redirectUri: c.oidcRedirectUri };
  };

  /** Start a flow for the given config: stash a PKCE verifier and redirect to the IdP. */
  const startFlow = async (cfg: OidcConfig, reply: FastifyReply) => {
    const discovery = await discover(cfg.issuer);
    const state = randomBytes(16).toString("base64url");
    const { verifier, challenge } = pkcePair();
    pending.set(state, { verifier, expiresAt: Date.now() + STATE_TTL_MS });
    return reply.redirect(buildAuthUrl(discovery, cfg, state, challenge));
  };

  /** Complete a flow: validate state, exchange the code, issue Argus tokens, redirect. */
  const completeFlow = async (cfg: OidcConfig, req: FastifyRequest, reply: FastifyReply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    const entry = state ? pending.get(state) : undefined;
    if (!code || !entry || entry.expiresAt < Date.now()) return reply.code(400).send({ error: "invalid_state" });
    pending.delete(state!);

    const discovery = await discover(cfg.issuer);
    const profile = await exchangeCode(discovery, cfg, code, entry.verifier);
    const user = await findOrProvisionUser(app.master, profile);
    if (!user || user.disabled) return reply.code(403).send({ error: "user_disabled" });

    const { token: refreshToken, id: sid } = await issueRefreshToken(app.master, user.id, app.config.refreshTtlSec, {
      userAgent: req.headers["user-agent"] ?? null,
      ip: req.ip,
    });
    const accessToken = await reply.jwtSign({ sub: user.id, sid, tv: user.tokenVersion }, { expiresIn: app.config.accessTtl });
    await app.audit(req, { action: "auth.oidc_login", category: "auth", target: user.id, actor: user.id });

    const url = `${app.config.publicUrl}/auth/callback#accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}`;
    return reply.redirect(url);
  };

  // ── Public: providers shown on the login page (enabled only; no secrets) ─────
  app.get("/api/auth/oidc/providers", async () => {
    const providers = await listEnabledPublicProviders(app.master);
    if (envConfig()) providers.push({ id: "env", name: "Single sign-on", brand: "generic", loginUrl: "/api/auth/oidc/login" });
    return { providers };
  });

  // ── Per-provider PKCE flow (DB providers) ───────────────────────────────────
  app.get("/api/auth/oidc/:id/login", async (req, reply) => {
    const encKey = process.env.ENCRYPTION_KEY;
    const cfg = encKey ? await getProviderConfig(app.master, (req.params as { id: string }).id, encKey, app.config.publicUrl) : null;
    if (!cfg) return reply.code(404).send({ error: "oidc_disabled" });
    return startFlow(cfg, reply);
  });

  app.get("/api/auth/oidc/:id/callback", async (req, reply) => {
    const encKey = process.env.ENCRYPTION_KEY;
    const cfg = encKey ? await getProviderConfig(app.master, (req.params as { id: string }).id, encKey, app.config.publicUrl) : null;
    if (!cfg) return reply.code(404).send({ error: "oidc_disabled" });
    return completeFlow(cfg, req, reply);
  });

  // ── Legacy single env-configured provider ───────────────────────────────────
  app.get("/api/auth/oidc/login", async (_req, reply) => {
    const cfg = envConfig();
    if (!cfg) return reply.code(404).send({ error: "oidc_disabled" });
    return startFlow(cfg, reply);
  });

  app.get("/api/auth/oidc/callback", async (req, reply) => {
    const cfg = envConfig();
    if (!cfg) return reply.code(404).send({ error: "oidc_disabled" });
    return completeFlow(cfg, req, reply);
  });

  // ── Provider administration (operator-facing, RBAC-guarded, audited) ─────────
  const providerBody = z.object({
    name: z.string().min(1),
    issuer: z.string().url(),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    brand: z.enum(OIDC_BRANDS).optional(),
  });

  app.get("/api/oidc-providers", { preHandler: [app.authenticate, app.requirePermission("settings:read")] }, async () => ({
    rows: await listOidcProviders(app.master, app.config.publicUrl),
  }));

  app.post("/api/oidc-providers", { preHandler: [app.authenticate, app.requirePermission("settings:write")] }, async (req, reply) => {
    const parsed = providerBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const encKey = process.env.ENCRYPTION_KEY;
    if (!encKey) return reply.code(500).send({ error: "encryption_key_missing" });
    const provider = await createOidcProvider(app.master, parsed.data, encKey, app.config.publicUrl);
    await app.audit(req, { action: "oidc.create", category: "settings", target: provider.id, after: { ...provider } });
    return reply.code(201).send({ provider });
  });

  app.patch("/api/oidc-providers/:id", { preHandler: [app.authenticate, app.requirePermission("settings:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = providerBody.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const encKey = process.env.ENCRYPTION_KEY;
    if (!encKey) return reply.code(500).send({ error: "encryption_key_missing" });
    const provider = await updateOidcProvider(app.master, id, parsed.data, encKey, app.config.publicUrl);
    if (!provider) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "oidc.update", category: "settings", target: id, after: { ...provider } });
    return { provider };
  });

  app.delete("/api/oidc-providers/:id", { preHandler: [app.authenticate, app.requirePermission("settings:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await deleteOidcProvider(app.master, id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "oidc.delete", category: "settings", target: id });
    return { ok: true };
  });
}
