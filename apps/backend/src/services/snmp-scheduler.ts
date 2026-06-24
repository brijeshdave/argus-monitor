/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Server-side SNMP scheduler. On a fixed interval it polls every enabled snmp
 * monitor's device and feeds the result through the same ingest pipeline the agents
 * use (events / uptime / unit-state) plus a live patch — so an SNMP-monitored device
 * (NAS, switch, UPS…) stays current with no agent involved. Mirrors the ping
 * scheduler; started from server.ts so the test app graph never opens sockets.
 */
import type { FastifyInstance } from "fastify";
import { snmpMetrics } from "@argus/db";
import { listEnabledSnmpMonitors } from "@/services/monitors.js";
import { getMonitorCred } from "@/services/monitor-cred.js";
import { getSnmpProfile } from "@/services/snmp-profiles.js";
import { processUnits } from "@/services/pipeline.js";
import { snmpCollect, type ProfileOid, type SnmpProfileLite } from "@/services/snmp.js";

const INTERVAL_MS = Number(process.env.SNMP_INTERVAL_MS ?? 60_000);

/** Parse a legacy inline OID list ([{label, oid}]) → ProfileOid[] (pre-profile monitors). */
function parseOids(raw: unknown): ProfileOid[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is { label?: unknown; oid?: unknown } => typeof o === "object" && o !== null)
    .map((o) => ({ label: String(o.label ?? o.oid ?? ""), oid: String(o.oid ?? "") }))
    .filter((o) => o.oid);
}

async function probe(
  app: FastifyInstance,
  monitor: { id: string; agentId: string; name: string; config: Record<string, unknown> },
): Promise<void> {
  const host = typeof monitor.config.host === "string" ? monitor.config.host : "";
  if (!host) return;
  const encKey = process.env.ENCRYPTION_KEY;
  const community =
    (encKey ? await getMonitorCred(app.master, monitor.id, encKey) : null) ??
    (typeof monitor.config.community === "string" ? monitor.config.community : "public");
  const version = typeof monitor.config.version === "string" ? monitor.config.version : "2c";

  // Resolve the device profile (the "MIB master"); fall back to standard + any
  // legacy inline OIDs for monitors created before profiles existed.
  const profileId = typeof monitor.config.profileId === "string" ? monitor.config.profileId : "";
  const dto = profileId ? await getSnmpProfile(app.master, profileId) : undefined;
  const profile: SnmpProfileLite = dto
    ? { standard: dto.standard, oids: dto.oids, tables: dto.tables, vendor: dto.vendor }
    : { standard: true, oids: parseOids(monitor.config.oids) };

  const snmp = await snmpCollect(host, { community, version, profile });
  const status = snmp.reachable ? "UP" : "DOWN";

  await processUnits(app.telemetry, monitor.agentId, [{ entity: monitor.name, status, meta: { snmp } }]);

  // Persist numeric readings (cpu/mem + numeric custom OIDs) for history charts.
  if (snmp.reachable) {
    const metrics: Record<string, number> = {};
    if (snmp.cpuPercent != null) metrics.cpu = snmp.cpuPercent;
    if (snmp.memUsedPct != null) metrics.mem = snmp.memUsedPct;
    for (const it of snmp.items ?? []) {
      const n = parseFloat(it.value);
      if (Number.isFinite(n)) metrics[it.label] = n;
    }
    // Per-row numeric table cells (e.g. per-disk temperature) → history series.
    for (const tbl of snmp.tables ?? []) {
      tbl.headers.forEach((h, ci) => {
        if (!/temp|°c|usage|percent|%/i.test(h)) return; // chart-worthy numeric columns
        for (const row of tbl.rows) {
          const n = parseFloat(row[ci] ?? "");
          if (Number.isFinite(n)) metrics[`${row[0] || "?"} ${h}`] = n;
        }
      });
    }
    if (Object.keys(metrics).length) await app.telemetry.insert(snmpMetrics).values({ monitorId: monitor.id, metrics });
  }

  app.operatorHub.broadcast({
    t: "patch",
    agentId: monitor.agentId,
    units: [{ sourceId: monitor.agentId, entity: monitor.name, status, pid: null, meta: { snmp } }],
    ts: new Date().toISOString(),
  });
}

async function sweep(app: FastifyInstance): Promise<void> {
  const monitors = await listEnabledSnmpMonitors(app.master);
  if (monitors.length === 0) return;
  await Promise.all(monitors.map((m) => probe(app, { id: m.id, agentId: m.agentId, name: m.name, config: (m.config ?? {}) as Record<string, unknown> })));
}

/** Start the SNMP scheduler; returns a stop function and registers an onClose hook. */
export function startSnmpScheduler(app: FastifyInstance): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sweep(app);
    } catch (err) {
      app.log.error({ err }, "snmp sweep failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref?.();
  void tick();
  const stop = () => clearInterval(timer);
  app.addHook("onClose", async () => stop());
  return stop;
}
