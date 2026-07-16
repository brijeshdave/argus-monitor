/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Monitor CRUD routes (operator-facing, RBAC-guarded, audited). Follows the
 * same shape as users.routes.ts and agents.routes.ts: thin routes, domain
 * logic in the service layer, zod validation at the boundary.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, eq, gte } from "drizzle-orm";
import { dbMetrics, folderMetrics, pingSamples, snmpMetrics, storageMetrics } from "@argus/db";
import { MONITOR_TYPES } from "@argus/shared";
import { forecastStorage } from "@argus/core";
import {
  createMonitor, deleteMonitor, ensureStoragePing, getMonitor, listMonitors, updateMonitor,
} from "@/services/monitors.js";
import { pruneEntityRefs } from "@/services/wallboards.js";
import { getAgent } from "@/services/agents.js";
import { pruneOrphanUnits } from "@/services/units.js";
import { dispatchCommand } from "@/services/agent-commands.js";
import { getMonitorSeries } from "@/services/monitor-series.js";
import { SECRET_FIELDS, deleteMonitorCred, setMonitorCred } from "@/services/monitor-cred.js";
import { cancelScan, pauseScan, resumeScan, runScan, scanState } from "@/services/scan-manager.js";

/**
 * Pull a sensitive field (SMB password / DB connection string) out of a monitor
 * config so it's never stored in monitors.config. Records the field name in
 * `credField` so the agent-config delivery re-injects it. Returns the secret (if
 * any) + the sanitised config.
 */
function extractCred(config: Record<string, unknown> | undefined): { cred?: string; config?: Record<string, unknown> } {
  if (!config) return { config };
  for (const field of SECRET_FIELDS) {
    const v = config[field];
    if (typeof v === "string" && v) {
      const { [field]: _omit, ...rest } = config;
      return { cred: v, config: { ...rest, credField: field } };
    }
  }
  return { config };
}

const createBody = z.object({
  agentId: z.string().min(1),
  type: z.enum(MONITOR_TYPES),
  name: z.string().min(1),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const updateBody = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  // Move the monitor to another agent/device (consolidate one physical device's
  // monitors into a single object).
  agentId: z.string().min(1).optional(),
});

const agentIdQuery = z.object({ agentId: z.string().optional() });

/** History window query: a custom `from` ISO wins, else a `hours` look-back. */
interface HistoryQuery { hours?: string; from?: string }
function historySince(q: HistoryQuery): string {
  if (q.from && !Number.isNaN(Date.parse(q.from))) return new Date(q.from).toISOString();
  const hours = Math.min(24 * 365 * 5, Math.max(1, Number(q.hours ?? 168) || 168));
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

export async function monitorRoutes(app: FastifyInstance): Promise<void> {
  // ── List monitors (optionally scoped to an agent) ──────────────────────────
  app.get("/api/monitors", { preHandler: [app.authenticate, app.requirePermission("monitors:read", { allowDevice: true })] }, async (req) => {
    const { agentId } = agentIdQuery.parse(req.query);
    return { rows: await listMonitors(app.master, agentId) };
  });

  // ── Per-monitor wallboard series (latency sparkline + 24h uptime %) ──────────
  app.get("/api/monitors/series", { preHandler: [app.authenticate, app.requirePermission("monitors:read")] }, async (req) => {
    const ids = String((req.query as { ids?: string }).ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return { series: await getMonitorSeries(app.master, app.telemetry, ids.slice(0, 200)) };
  });

  // ── SQL Server metric trend points for a database monitor ───────────────────
  app.get("/api/monitors/:id/db-metrics", { preHandler: [app.authenticate, app.requirePermission("monitors:read")] }, async (req) => {
    const { id } = req.params as { id: string };
    const since = historySince(req.query as HistoryQuery);
    const points = await app.telemetry
      .select({ ts: dbMetrics.ts, metrics: dbMetrics.metrics })
      .from(dbMetrics)
      .where(and(eq(dbMetrics.monitorId, id), gte(dbMetrics.ts, since)))
      .orderBy(dbMetrics.ts);
    return { points };
  });

  // ── SNMP numeric history (cpu/mem + custom OIDs) for a snmp monitor ──────────
  app.get("/api/monitors/:id/snmp-metrics", { preHandler: [app.authenticate, app.requirePermission("monitors:read")] }, async (req) => {
    const { id } = req.params as { id: string };
    const since = historySince(req.query as HistoryQuery);
    const points = await app.telemetry
      .select({ ts: snmpMetrics.ts, metrics: snmpMetrics.metrics })
      .from(snmpMetrics)
      .where(and(eq(snmpMetrics.monitorId, id), gte(snmpMetrics.ts, since)))
      .orderBy(snmpMetrics.ts);
    return { points };
  });

  // ── Reachability/latency history for a ping monitor ──────────────────────────
  app.get("/api/monitors/:id/ping-samples", { preHandler: [app.authenticate, app.requirePermission("monitors:read")] }, async (req) => {
    const { id } = req.params as { id: string };
    const since = historySince(req.query as HistoryQuery);
    const points = await app.telemetry
      .select({ ts: pingSamples.ts, up: pingSamples.up, latencyMs: pingSamples.latencyMs })
      .from(pingSamples)
      .where(and(eq(pingSamples.monitorId, id), gte(pingSamples.ts, since)))
      .orderBy(pingSamples.ts);
    return { points };
  });

  // ── Storage capacity trend points for a storage monitor ─────────────────────
  app.get("/api/monitors/:id/storage-metrics", { preHandler: [app.authenticate, app.requirePermission("monitors:read")] }, async (req) => {
    const { id } = req.params as { id: string };
    const since = historySince(req.query as HistoryQuery);
    const points = await app.telemetry
      .select({ ts: storageMetrics.ts, usedPct: storageMetrics.usedPct, usedBytes: storageMetrics.usedBytes, totalBytes: storageMetrics.totalBytes })
      .from(storageMetrics)
      .where(and(eq(storageMetrics.storageId, id), gte(storageMetrics.ts, since)))
      .orderBy(storageMetrics.ts);
    return { points, forecast: forecastStorage(points) };
  });

  // ── Per-folder size/count history for a storage monitor ─────────────────────
  app.get("/api/monitors/:id/folder-metrics", { preHandler: [app.authenticate, app.requirePermission("monitors:read")] }, async (req) => {
    const { id } = req.params as { id: string };
    const folder = (req.query as { folder?: string }).folder;
    if (!folder) return { points: [] };
    const since = historySince(req.query as HistoryQuery);
    const points = await app.telemetry
      .select({ ts: folderMetrics.ts, sizeBytes: folderMetrics.sizeBytes, fileCount: folderMetrics.fileCount, folderCount: folderMetrics.folderCount })
      .from(folderMetrics)
      .where(and(eq(folderMetrics.storageId, id), eq(folderMetrics.folder, folder), gte(folderMetrics.ts, since)))
      .orderBy(folderMetrics.ts);
    return { points };
  });

  // ── Folder-scan control for server-side storage monitors ────────────────────
  // GET status; POST scan (manual "Scan now") / pause / resume / cancel. The walk
  // runs in the scan-manager (background) — POST returns the current state at once.
  app.get("/api/monitors/:id/scan", { preHandler: [app.authenticate, app.requirePermission("monitors:read")] }, async (req) => {
    return { scan: scanState((req.params as { id: string }).id) };
  });

  const scanAction = (act: "scan" | "pause" | "resume" | "cancel") =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const monitor = await getMonitor(app.master, id);
      if (!monitor || monitor.type !== "storage") return reply.code(404).send({ error: "not_found" });
      const serverSide = (monitor.config as { server?: unknown }).server === true;
      // Agent-collected storage: "Scan now" is a rescan command pushed to the agent
      // (pause/resume/cancel + live progress are server-side only for now).
      if (!serverSide) {
        // Agent-collected: "Scan now" + cancel are pushed as control commands; the
        // agent streams progress back (pause/resume aren't supported there).
        if (act === "scan") await dispatchCommand(app.master, app.agentHub, monitor.agentId, "rescan", { monitorId: id });
        else if (act === "cancel") await dispatchCommand(app.master, app.agentHub, monitor.agentId, "cancelScan", { monitorId: id });
        else return reply.code(400).send({ error: "agent_scan", message: "Only Scan now / Cancel are supported for agent-collected storage." });
        await app.audit(req, { action: `monitor.scan.agent.${act}`, category: "monitors", target: id });
        return { scan: scanState(id) };
      }
      if (act === "scan") void runScan(app, id); // fire-and-forget (can take minutes)
      else if (act === "pause") pauseScan(id);
      else if (act === "resume") resumeScan(id);
      else cancelScan(id);
      await app.audit(req, { action: `monitor.scan.${act}`, category: "monitors", target: id });
      return { scan: scanState(id) };
    };

  app.post("/api/monitors/:id/scan", { preHandler: [app.authenticate, app.requirePermission("monitors:write")] }, scanAction("scan"));
  app.post("/api/monitors/:id/scan/pause", { preHandler: [app.authenticate, app.requirePermission("monitors:write")] }, scanAction("pause"));
  app.post("/api/monitors/:id/scan/resume", { preHandler: [app.authenticate, app.requirePermission("monitors:write")] }, scanAction("resume"));
  app.post("/api/monitors/:id/scan/cancel", { preHandler: [app.authenticate, app.requirePermission("monitors:write")] }, scanAction("cancel"));

  // ── Get a single monitor ───────────────────────────────────────────────────
  app.get("/api/monitors/:id", { preHandler: [app.authenticate, app.requirePermission("monitors:read")] }, async (req, reply) => {
    const monitor = await getMonitor(app.master, (req.params as { id: string }).id);
    return monitor ? { monitor } : reply.code(404).send({ error: "not_found" });
  });

  // ── Create a monitor ───────────────────────────────────────────────────────
  app.post("/api/monitors", { preHandler: [app.authenticate, app.requirePermission("monitors:write")] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const { cred, config } = extractCred(parsed.data.config);
    const monitor = await createMonitor(app.master, { ...parsed.data, config });
    if (cred) {
      const encKey = process.env.ENCRYPTION_KEY;
      if (encKey) await setMonitorCred(app.master, monitor.id, cred, encKey);
    }
    // A NAS gets a companion server-side ping so reachability is visible separately.
    if (monitor.type === "storage") {
      await ensureStoragePing(app.master, monitor.agentId, monitor.name, String((config ?? {}).path ?? ""));
    }
    await app.audit(req, { action: "monitor.create", category: "monitors", target: monitor.id, after: monitor });
    return reply.code(201).send({ monitor });
  });

  // ── Patch a monitor ────────────────────────────────────────────────────────
  app.patch("/api/monitors/:id", { preHandler: [app.authenticate, app.requirePermission("monitors:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    // Moving to another agent: validate the target exists first.
    const prev = await getMonitor(app.master, id);
    if (parsed.data.agentId && parsed.data.agentId !== prev?.agentId && !(await getAgent(app.master, parsed.data.agentId))) {
      return reply.code(400).send({ error: "invalid_agent", message: "Target agent not found." });
    }
    const { cred, config } = extractCred(parsed.data.config);
    const monitor = await updateMonitor(app.master, id, { ...parsed.data, config });
    if (!monitor) return reply.code(404).send({ error: "not_found" });
    // After a move, drop the stale live-state row left under the old agent.
    if (prev && parsed.data.agentId && parsed.data.agentId !== prev.agentId) {
      await pruneOrphanUnits(app.master, app.telemetry, prev.agentId);
    }
    if (cred) {
      const encKey = process.env.ENCRYPTION_KEY;
      if (encKey) await setMonitorCred(app.master, id, cred, encKey);
    }
    await app.audit(req, { action: "monitor.update", category: "monitors", target: id, after: monitor });
    return { monitor };
  });

  // ── Delete a monitor ───────────────────────────────────────────────────────
  app.delete("/api/monitors/:id", { preHandler: [app.authenticate, app.requirePermission("monitors:delete")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await deleteMonitor(app.master, id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    // Drop any wallboard tiles that referenced this monitor (no dangling tiles).
    await pruneEntityRefs(app.master, [id]);
    await deleteMonitorCred(app.master, id); // remove any stored credential
    await app.audit(req, { action: "monitor.delete", category: "monitors", target: id });
    return { ok: true };
  });
}
