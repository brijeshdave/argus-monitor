/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Builds the operator LIVE snapshot: the current health baseline an operator
 * receives the moment they connect to `WS /ws`. Reads agents from the master DB
 * and last-known unit states from the telemetry DB.
 */
import { sql } from "drizzle-orm";
import { agents, hostMetrics, unitStates, type MasterDb, type TelemetryDb } from "@argus/db";
import type { LiveSnapshot, LiveUnit } from "@argus/shared";
import { isAgentOnline, type IsConnected } from "@/services/agents.js";

export async function getLiveSnapshot(master: MasterDb, telemetry: TelemetryDb, isConnected?: IsConnected): Promise<LiveSnapshot> {
  const agentRows = await master
    .select({
      id: agents.id,
      name: agents.name,
      status: agents.status,
      lastSeenAt: agents.lastSeenAt,
    })
    .from(agents);

  const unitRows = await telemetry
    .select({
      sourceId: unitStates.sourceId,
      entity: unitStates.entity,
      status: unitStates.status,
      pid: unitStates.pid,
      sample: unitStates.sample,
      updatedAt: unitStates.updatedAt,
    })
    .from(unitStates);

  const units: LiveUnit[] = unitRows.map((u) => ({
    sourceId: u.sourceId,
    entity: u.entity,
    status: u.status as LiveUnit["status"],
    pid: u.pid ?? null,
    since: u.updatedAt ?? null,
    meta: (u.sample as LiveUnit["meta"]) ?? null,
  }));

  // Latest host CPU/mem per agent (one row each) for the card gauges.
  const metricRows = await telemetry
    .selectDistinctOn([hostMetrics.agentId], { agentId: hostMetrics.agentId, cpuPct: hostMetrics.cpuPct, memPct: hostMetrics.memPct })
    .from(hostMetrics)
    .orderBy(hostMetrics.agentId, sql`${hostMetrics.ts} desc`);
  const metricByAgent = new Map(metricRows.map((m) => [m.agentId, m]));

  return {
    t: "snapshot",
    agents: agentRows.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      online: isConnected ? isAgentOnline(isConnected(a.id), a.lastSeenAt ?? null) : false,
      lastSeenAt: a.lastSeenAt ?? null,
      cpuPct: metricByAgent.get(a.id)?.cpuPct ?? null,
      memPct: metricByAgent.get(a.id)?.memPct ?? null,
    })),
    units,
    ts: new Date().toISOString(),
  };
}
