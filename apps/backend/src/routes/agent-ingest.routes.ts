/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Agent-facing endpoints, authenticated by the connection key (header
 * `x-argus-key`), NOT a JWT. `/register` is allowed while pending; `/ingest`
 * requires an approved agent. This is the HTTP push path; the WSS control channel
 * (commands/config) is handled on the control channel.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AgentIngestRequest, AgentRegisterRequest } from "@argus/shared";
import { resolveAgentKey, touchKeyUsage, type AgentKeyRow } from "@/services/agent-keys.js";
import { agentDebugEnabled, effectiveIngestHosts, effectivePushInterval, effectiveTimezone, isApproved, registerAgent, touchAgent } from "@/services/agents.js";
import { ingest } from "@/services/ingest.js";
import { dbMetrics, storageMetrics } from "@argus/db";
import { recordFolderMetrics } from "@/services/scan-manager.js";
import { getDhcpLease } from "@/services/fortinet.js";
import { ensureDefaultPingMonitor, listAgentMonitorConfig, listMonitors } from "@/services/monitors.js";
import { pruneOrphanUnits } from "@/services/units.js";
import { credFieldFor, getMonitorCred } from "@/services/monitor-cred.js";
import { latestBuildFor, readBuildFile } from "@/services/agent-builds.js";
import { saveInventory } from "@/services/inventory.js";
import type { AgentInventory } from "@argus/shared";

declare module "fastify" {
  interface FastifyRequest {
    agentKey?: AgentKeyRow;
  }
}

export async function agentIngestRoutes(app: FastifyInstance): Promise<void> {
  // Connection-key auth preHandler.
  const requireKey = async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = req.headers["x-argus-key"];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key) return reply.code(401).send({ error: "missing_key" });
    const row = await resolveAgentKey(app.master, key);
    if (!row) return reply.code(401).send({ error: "invalid_key" });
    req.agentKey = row;
    await touchKeyUsage(app.master, row.id);
  };

  app.post("/api/agent/register", { preHandler: [requireKey] }, async (req) => {
    const body = (req.body ?? {}) as AgentRegisterRequest;
    const res = await registerAgent(app.master, req.agentKey!, body);
    // Backfill the default reachability ping for agents approved before the feature
    // existed (idempotent — only creates it once, when approved and an address is known).
    if (res.status === "approved") {
      await ensureDefaultPingMonitor(app.master, res.agentId, body.address ?? null);
    }
    return res;
  });

  // Pull the agent's monitor list. Only enabled monitors for the bound, approved
  // agent are returned — the collectors run off this list each tick.
  app.get("/api/agent/config", { preHandler: [requireKey] }, async (req, reply) => {
    const agentId = req.agentKey!.agentId;
    if (!agentId || !(await isApproved(app.master, agentId))) {
      return reply.code(403).send({ error: "not_approved" });
    }
    const monitors = await listAgentMonitorConfig(app.master, agentId);
    // Inject the decrypted credential (DB connection string / SMB password) into the
    // right config field for types that need one; it never leaves the backend except
    // over this key-authed TLS link.
    const encKey = process.env.ENCRYPTION_KEY;
    if (encKey) {
      for (const m of monitors) {
        const field = credFieldFor(m.config);
        if (!field) continue;
        const cred = await getMonitorCred(app.master, m.id, encKey);
        if (cred) m.config = { ...m.config, [field]: cred };
      }
    }
    const pushIntervalSec = await effectivePushInterval(app.master, agentId);
    const timezone = await effectiveTimezone(app.master);
    const ingestHosts = await effectiveIngestHosts(app.master);
    const debug = await agentDebugEnabled(app.master, agentId);
    return { monitors, pushIntervalSec, timezone, ingestHosts, debug };
  });

  app.post("/api/agent/ingest", { preHandler: [requireKey] }, async (req, reply) => {
    const agentId = req.agentKey!.agentId;
    if (!agentId || !(await isApproved(app.master, agentId))) {
      return reply.code(403).send({ error: "not_approved" });
    }
    await touchAgent(app.master, agentId);
    const payload = (req.body ?? {}) as AgentIngestRequest;
    // Enrich connected clients with FortiGate DHCP leases (names/MACs the agent
    // couldn't resolve itself, incl. cross-subnet clients) before storing/broadcasting.
    for (const u of payload.units ?? []) {
      for (const c of u.meta?.clients ?? []) {
        if (c.hostname && c.mac) continue;
        const lease = getDhcpLease(c.ip);
        if (!lease) continue;
        if (!c.hostname && lease.hostname) { c.hostname = lease.hostname; c.hostnameSource = "dhcp"; }
        if (!c.mac && lease.mac) c.mac = lease.mac;
      }
    }
    await ingest(app.telemetry, agentId, payload);
    // Self-heal: drop unit rows left over from renamed/removed monitors.
    if (payload.units?.length) await pruneOrphanUnits(app.master, app.telemetry, agentId);

    // Append time-series points for database + storage units (for trend charts).
    const dbUnits = (payload.units ?? []).filter((u) => u.meta?.db);
    const storageUnits = (payload.units ?? []).filter((u) => u.meta?.storage);
    if (dbUnits.length || storageUnits.length) {
      const idByName = new Map((await listMonitors(app.master, agentId)).map((m) => [m.name, m.id]));
      const dbRows = dbUnits.flatMap((u) => {
        const monitorId = idByName.get(u.entity);
        return monitorId ? [{ monitorId, metrics: u.meta!.db as Record<string, unknown> }] : [];
      });
      if (dbRows.length) await app.telemetry.insert(dbMetrics).values(dbRows);

      const stRows = storageUnits.flatMap((u) => {
        const storageId = idByName.get(u.entity);
        const s = u.meta!.storage!;
        return storageId ? [{ storageId, usedPct: s.usedPct ?? null, usedBytes: s.usedBytes ?? null, totalBytes: s.totalBytes ?? null, metrics: s as unknown as Record<string, unknown> }] : [];
      });
      if (stRows.length) await app.telemetry.insert(storageMetrics).values(stRows);

      // Per-folder history snapshot (throttled inside recordFolderMetrics — the agent
      // re-sends cached folders every tick).
      for (const u of storageUnits) {
        const storageId = idByName.get(u.entity);
        if (storageId) await recordFolderMetrics(app.telemetry, storageId, u.meta!.storage!.folders);
      }
    }

    // Push a live patch to connected operators so dashboards update without polling.
    if (payload.units?.length) {
      app.operatorHub.broadcast({
        t: "patch",
        agentId,
        units: payload.units.map((u) => ({
          sourceId: agentId,
          entity: u.entity,
          status: u.status,
          pid: u.pid ?? null,
          meta: u.meta ?? null,
        })),
        ts: new Date().toISOString(),
      });
    }

    // Push fresh host CPU/mem to operators for the live card gauges.
    if (payload.metrics && (payload.metrics.cpuPct != null || payload.metrics.memPct != null)) {
      app.operatorHub.broadcast({
        t: "agent",
        agents: [{ id: agentId, cpuPct: payload.metrics.cpuPct ?? null, memPct: payload.metrics.memPct ?? null }],
        ts: new Date().toISOString(),
      });
    }

    // Stream this tick's log lines to operators tailing the agent's console.
    if (payload.logs?.length) {
      const now = new Date().toISOString();
      app.operatorHub.broadcast({
        t: "log",
        agentId,
        lines: payload.logs.map((l) => ({
          level: l.level,
          message: l.message,
          category: l.category,
          ts: now,
        })),
        ts: now,
      });
    }

    return { ok: true };
  });

  // Host inventory push: an approved agent uploads its discoverable services +
  // processes so the UI can offer a monitor pick-list. Replaces the prior snapshot.
  app.post("/api/agent/inventory", { preHandler: [requireKey] }, async (req, reply) => {
    const agentId = req.agentKey!.agentId;
    if (!agentId || !(await isApproved(app.master, agentId))) {
      return reply.code(403).send({ error: "not_approved" });
    }
    const body = (req.body ?? {}) as Partial<AgentInventory>;
    await saveInventory(app.telemetry, agentId, {
      services: Array.isArray(body.services) ? body.services : [],
      processes: Array.isArray(body.processes) ? body.processes : [],
    });
    return { ok: true };
  });

  // Self-update download: an approved agent fetches its new binary here, authed by
  // its connection key (it has no operator JWT). The agent asks for its own platform
  // (argus-agent-<os>-<arch>[.exe]); we resolve that to the LATEST build's binary.
  app.get("/api/agent/download/:name", { preHandler: [requireKey] }, async (req, reply) => {
    const agentId = req.agentKey!.agentId;
    if (!agentId || !(await isApproved(app.master, agentId))) {
      return reply.code(403).send({ error: "not_approved" });
    }
    const { name } = req.params as { name: string };
    const m = /^argus-agent-([a-z0-9]+)-([a-z0-9]+)(?:\.exe)?$/.exec(name);
    if (!m) return reply.code(400).send({ error: "invalid_request" });
    const [, os, arch] = m;
    const latest = await latestBuildFor(os!, arch!);
    if (!latest) return reply.code(404).send({ error: "not_found" });
    let file: { buf: Buffer; filename: string };
    try {
      file = await readBuildFile(latest.version, latest.os, latest.arch);
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.buf);
  });
}
