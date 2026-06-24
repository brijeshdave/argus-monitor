/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Application factory. Builds a fully-wired Fastify instance (security middleware,
 * DB connections, auth/RBAC/audit plugins, routes) without listening — so the same
 * graph is used by the server entrypoint and by integration tests (which inject an
 * in-memory PGlite database).
 */
import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import {
  createMasterConnection, createTelemetryConnection, type MasterDb, type TelemetryDb,
} from "@argus/db";
import { loadConfig, type AppConfig } from "@/config.js";
import authPlugin from "@/plugins/auth.js";
import rbacPlugin from "@/plugins/rbac.js";
import auditPlugin from "@/plugins/audit.js";
import agentWsPlugin from "@/plugins/agent-ws.js";
import operatorWsPlugin from "@/plugins/operator-ws.js";
import { authRoutes } from "@/routes/auth.routes.js";
import { userRoutes } from "@/routes/users.routes.js";
import { sessionRoutes } from "@/routes/sessions.routes.js";
import { groupRoutes } from "@/routes/groups.routes.js";
import { roleRoutes } from "@/routes/roles.routes.js";
import { permissionRoutes } from "@/routes/permissions.routes.js";
import { settingsRoutes } from "@/routes/settings.routes.js";
import { retentionRoutes } from "@/routes/retention.routes.js";
import { oidcRoutes } from "@/routes/oidc.routes.js";
import { agentRoutes } from "@/routes/agents.routes.js";
import { agentBuildRoutes } from "@/routes/agent-builds.routes.js";
import { agentIngestRoutes } from "@/routes/agent-ingest.routes.js";
import { monitorRoutes } from "@/routes/monitors.routes.js";
import { clientMetaRoutes } from "@/routes/client-meta.routes.js";
import { telemetryRoutes } from "@/routes/telemetry.routes.js";
import { wallboardRoutes } from "@/routes/wallboards.routes.js";
import { deviceRoutes } from "@/routes/devices.routes.js";
import { tickerRoutes } from "@/routes/ticker.routes.js";
import { publicRoutes } from "@/routes/public.routes.js";
import { backupRoutes } from "@/routes/backups.routes.js";
import { reportRoutes } from "@/routes/reports.routes.js";
import { developerDocsRoutes } from "@/routes/developer-docs.routes.js";
import { snmpProfileRoutes } from "@/routes/snmp-profiles.routes.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    master: MasterDb;
    telemetry: TelemetryDb;
  }
}

export interface BuildAppDeps {
  config?: AppConfig;
  /** Injected DB connections (tests). When omitted, connections come from env. */
  connections?: { master: MasterDb; telemetry: TelemetryDb; close?: () => Promise<void> };
}

/**
 * Coerce the TRUST_PROXY env string into the shape Fastify expects. A bare boolean
 * (`true`/`false`/`on`/`off`/`1`/`0`) → boolean; a number → trusted hop count; any
 * other non-empty value → passed through as a subnet/IP allow-list (proxy-addr CSV).
 * Without this, "true" would be (mis)read as an IP literal and the proxy never
 * trusted — so req.ip stayed the proxy/container address instead of the real client.
 */
export function parseTrustProxy(v: string | undefined): boolean | number | string {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  if (["true", "yes", "on"].includes(s)) return true;
  if (["false", "no", "off", ""].includes(s)) return false;
  if (/^\d+$/.test(s)) return Number(s); // hop count
  return v.trim(); // subnet / IP allow-list, e.g. "172.16.0.0/12"
}

export async function buildApp(deps: BuildAppDeps = {}): Promise<FastifyInstance> {
  const cfg = deps.config ?? loadConfig();

  const app = Fastify({
    logger: {
      level: cfg.logLevel,
      transport:
        cfg.nodeEnv === "development"
          ? { target: "pino-pretty", options: { translateTime: "SYS:standard" } }
          : undefined,
    },
    trustProxy: parseTrustProxy(cfg.trustProxy),
  });

  app.decorate("config", cfg);

  // Database — injected (tests) or created from environment.
  if (deps.connections) {
    app.decorate("master", deps.connections.master);
    app.decorate("telemetry", deps.connections.telemetry);
    if (deps.connections.close) app.addHook("onClose", deps.connections.close);
  } else {
    const master = createMasterConnection();
    const telemetry = createTelemetryConnection();
    app.decorate("master", master.db);
    app.decorate("telemetry", telemetry.db);
    app.addHook("onClose", async () => {
      await master.close();
      await telemetry.close();
    });
  }

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(rateLimit, { max: cfg.rateLimitMax, timeWindow: "1 minute" });

  app.get("/healthz", async () => ({ status: "ok", service: "argus-backend", ts: new Date().toISOString() }));

  // Cross-cutting plugins (decorate authenticate / requirePermission / audit).
  await app.register(authPlugin);
  await app.register(rbacPlugin);
  await app.register(auditPlugin);

  // @fastify/websocket may only be registered ONCE; do it here so both the agent
  // control channel and the operator live channel just add routes.
  await app.register(websocket);
  await app.register(agentWsPlugin);
  await app.register(operatorWsPlugin);

  // Feature routes.
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(sessionRoutes);
  await app.register(groupRoutes);
  await app.register(roleRoutes);
  await app.register(permissionRoutes);
  await app.register(settingsRoutes);
  await app.register(retentionRoutes);
  await app.register(oidcRoutes);
  await app.register(agentRoutes);
  await app.register(agentBuildRoutes);
  await app.register(agentIngestRoutes);
  await app.register(monitorRoutes);
  await app.register(snmpProfileRoutes);
  await app.register(clientMetaRoutes);
  await app.register(telemetryRoutes);
  await app.register(wallboardRoutes);
  await app.register(deviceRoutes);
  await app.register(tickerRoutes);
  await app.register(publicRoutes);
  await app.register(backupRoutes);
  await app.register(reportRoutes);
  await app.register(developerDocsRoutes);

  return app;
}
