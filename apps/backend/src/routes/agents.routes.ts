/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Agent + connection-key management routes (operator-facing, RBAC-guarded, audited).
 * The connection key is returned exactly once at mint time and never logged/audited.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, gte } from "drizzle-orm";
import { hostMetrics } from "@argus/db";
import { AGENT_PUSH_INTERVAL_MAX, AGENT_PUSH_INTERVAL_MIN } from "@argus/shared";
import {
  approveAgent, createDevice, deleteAgent, effectivePushInterval, getAgent, listAgents, revokeAgent, updateAgent,
} from "@/services/agents.js";
import {
  listConnectionKeys, mintConnectionKey, revokeConnectionKey,
} from "@/services/agent-keys.js";
import { dispatchCommand, listCommands } from "@/services/agent-commands.js";
import { AGENT_VERSION, compareSemver } from "@/services/agent-builds.js";
import { ensureDefaultPingMonitor, listMonitors } from "@/services/monitors.js";
import { pruneEntityRefs } from "@/services/wallboards.js";
import { deleteInventory, getInventory } from "@/services/inventory.js";
import { purgeAgentTelemetry } from "@/services/units.js";
import { deleteMonitorCred } from "@/services/monitor-cred.js";

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // The control-socket registry is the source of truth for live connectivity.
  const isConnected = (agentId: string): boolean => app.agentHub.isOnline(agentId);

  // Host CPU/RAM history for an agent (for the metrics charts).
  app.get("/api/agents/:id/metrics", { preHandler: [app.authenticate, app.requirePermission("agents:read")] }, async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { hours?: string; from?: string };
    const since = q.from && !Number.isNaN(Date.parse(q.from))
      ? new Date(q.from).toISOString()
      : new Date(Date.now() - Math.min(24 * 365 * 5, Math.max(1, Number(q.hours ?? 168) || 168)) * 3600_000).toISOString();
    const points = await app.telemetry
      .select({ ts: hostMetrics.ts, cpuPct: hostMetrics.cpuPct, memPct: hostMetrics.memPct, memUsedMb: hostMetrics.memUsedMb })
      .from(hostMetrics)
      .where(and(eq(hostMetrics.agentId, id), gte(hostMetrics.ts, since)))
      .orderBy(hostMetrics.ts);
    return { points };
  });

  app.get("/api/agents", { preHandler: [app.authenticate, app.requirePermission("agents:read")] }, async () => ({
    rows: await listAgents(app.master, isConnected),
  }));

  app.get("/api/agents/:id", { preHandler: [app.authenticate, app.requirePermission("agents:read")] }, async (req, reply) => {
    const agent = await getAgent(app.master, (req.params as { id: string }).id, isConnected);
    return agent ? { agent } : reply.code(404).send({ error: "not_found" });
  });

  // Create an agentless device (NAS/switch/UPS…) probed server-side via SNMP/ping.
  app.post("/api/agents/device", { preHandler: [app.authenticate, app.requirePermission("agents:write")] }, async (req, reply) => {
    const parsed = z.object({ name: z.string().min(1).max(120), address: z.string().max(253).optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const device = await createDevice(app.master, { name: parsed.data.name.trim(), address: parsed.data.address?.trim() || null });
    await app.audit(req, { action: "device.create", category: "agents", target: device.id, after: device });
    return { agent: device };
  });

  app.post("/api/agents/:id/approve", { preHandler: [app.authenticate, app.requirePermission("agents:approve")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await approveAgent(app.master, id, isConnected);
    if (!agent) return reply.code(404).send({ error: "not_found" });
    // Give every approved host a default server-side reachability ping (idempotent).
    await ensureDefaultPingMonitor(app.master, id, agent.address);
    await app.audit(req, { action: "agent.approve", category: "agents", target: id });
    return { agent };
  });

  app.post("/api/agents/:id/revoke", { preHandler: [app.authenticate, app.requirePermission("agents:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await revokeAgent(app.master, id, isConnected);
    if (!agent) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "agent.revoke", category: "agents", target: id });
    return { agent };
  });

  app.patch("/api/agents/:id", { preHandler: [app.authenticate, app.requirePermission("agents:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({
      name: z.string().min(1).optional(),
      pushIntervalSec: z.number().int().min(AGENT_PUSH_INTERVAL_MIN).max(AGENT_PUSH_INTERVAL_MAX).nullable().optional(),
      debug: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const agent = await updateAgent(app.master, id, parsed.data, isConnected);
    if (!agent) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "agent.update", category: "agents", target: id, after: agent });
    // Apply changed cadence / debug flag to the running agent immediately over the
    // control channel (no restart).
    if (parsed.data.pushIntervalSec !== undefined) {
      const intervalSec = await effectivePushInterval(app.master, id);
      await dispatchCommand(app.master, app.agentHub, id, "config", { intervalSec });
    }
    if (parsed.data.debug !== undefined) {
      await dispatchCommand(app.master, app.agentHub, id, "config", { debug: parsed.data.debug });
    }
    return { agent };
  });

  // Re-push the effective cadence to every agent — used after the global default
  // changes so all agents on the default converge live (no restart).
  app.post("/api/agents/sync-config", { preHandler: [app.authenticate, app.requirePermission("agents:write")] }, async (req, reply) => {
    const all = await listAgents(app.master, isConnected);
    let pushed = 0;
    for (const a of all) {
      if (a.kind !== "agent" || a.status !== "approved") continue;
      const intervalSec = await effectivePushInterval(app.master, a.id);
      await dispatchCommand(app.master, app.agentHub, a.id, "config", { intervalSec });
      pushed += 1;
    }
    await app.audit(req, { action: "agent.config.sync", category: "agents", after: { pushed } });
    return reply.send({ pushed });
  });

  app.delete("/api/agents/:id", { preHandler: [app.authenticate, app.requirePermission("agents:delete")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    // Capture the agent's monitor ids before the cascade delete so we can also drop
    // their wallboard tiles (deleting an agent cascade-deletes its monitors).
    const monitorIds = (await listMonitors(app.master, id)).map((m) => m.id);
    // Drop stored monitor credentials before the cascade removes the monitor rows.
    for (const mid of monitorIds) await deleteMonitorCred(app.master, mid);
    const ok = await deleteAgent(app.master, id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    await pruneEntityRefs(app.master, [id, ...monitorIds]);
    await deleteInventory(app.telemetry, id);
    // Purge all telemetry/history for this agent + its monitors.
    await purgeAgentTelemetry(app.telemetry, id, monitorIds);
    await app.audit(req, { action: "agent.delete", category: "agents", target: id });
    return { ok: true };
  });

  // ── Remote commands (pushed over the WSS control channel) ─────────────────
  app.post("/api/agents/:id/restart", { preHandler: [app.authenticate, app.requirePermission("agents:restart")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await getAgent(app.master, id))) return reply.code(404).send({ error: "not_found" });
    const command = await dispatchCommand(app.master, app.agentHub, id, "restart");
    await app.audit(req, { action: "agent.restart", category: "agents", target: id });
    return { command, delivered: command.status === "sent" };
  });

  app.post("/api/agents/:id/update", { preHandler: [app.authenticate, app.requirePermission("agents:update")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await getAgent(app.master, id);
    if (!agent) return reply.code(404).send({ error: "not_found" });
    const parsed = z.object({ version: z.string().optional(), url: z.string().optional(), force: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    // Don't ship an update the agent doesn't need: skip when it's already at/above
    // the latest built version (unless an explicit url/version override, or force).
    const target = parsed.data.version ?? AGENT_VERSION;
    if (!parsed.data.url && !parsed.data.force && agent.version && compareSemver(agent.version, target) >= 0) {
      return { alreadyUpToDate: true, currentVersion: agent.version, latestVersion: target, delivered: false };
    }

    // Tell the agent the target version so it can guard against a needless swap too.
    const payload = { ...parsed.data, version: target };
    const command = await dispatchCommand(app.master, app.agentHub, id, "update", payload);
    await app.audit(req, { action: "agent.update", category: "agents", target: id, after: payload });
    return { command, delivered: command.status === "sent", currentVersion: agent.version, latestVersion: target };
  });

  app.get("/api/agents/:id/commands", { preHandler: [app.authenticate, app.requirePermission("agents:read")] }, async (req) => ({
    rows: await listCommands(app.master, (req.params as { id: string }).id),
  }));

  // Discovered services/processes for the monitor pick-list.
  app.get("/api/agents/:id/inventory", { preHandler: [app.authenticate, app.requirePermission("agents:read")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await getAgent(app.master, id, isConnected))) return reply.code(404).send({ error: "not_found" });
    return { inventory: await getInventory(app.telemetry, id) };
  });

  // ── Connection keys ──────────────────────────────────────────────────────
  app.get("/api/agent-keys", { preHandler: [app.authenticate, app.requirePermission("agents:read")] }, async () => ({
    rows: await listConnectionKeys(app.master),
  }));

  app.post("/api/agent-keys", { preHandler: [app.authenticate, app.requirePermission("agents:write")] }, async (req, reply) => {
    const parsed = z.object({ label: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) return reply.code(500).send({ error: "encryption_key_missing" });

    const { keyId, key } = await mintConnectionKey(app.master, parsed.data, encryptionKey);
    await app.audit(req, { action: "agentkey.mint", category: "agents", target: keyId, after: { label: parsed.data.label } });
    // The key is shown ONCE; it is intentionally absent from the audit payload.
    return reply.code(201).send({ keyId, key });
  });

  app.post("/api/agent-keys/:id/revoke", { preHandler: [app.authenticate, app.requirePermission("agents:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await revokeConnectionKey(app.master, id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "agentkey.revoke", category: "agents", target: id });
    return { ok: true };
  });
}
