/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Unit-state hygiene. A monitor that is renamed or deleted leaves its old
 * unit_states row behind (the diff baseline keys on entity name, and the agent
 * simply stops reporting the old name). This prunes those orphans: any unit for an
 * agent whose entity is no longer one of that agent's monitor names. Every legit
 * unit — agent-collected, the server-side ping, db/storage — uses a monitor name as
 * its entity, so the monitor list is the authoritative whitelist.
 */
import { and, eq, inArray, notInArray } from "drizzle-orm";
import {
  clientEvents, dbMetrics, folderMetrics, hostMetrics, logs, monitors, notifications,
  pingSamples, snmpMetrics, statusEvents, storageMetrics, unitStates, uptimeBuckets,
  type MasterDb, type TelemetryDb,
} from "@argus/db";

export async function pruneOrphanUnits(master: MasterDb, telemetry: TelemetryDb, agentId: string): Promise<void> {
  const names = (await master.select({ name: monitors.name }).from(monitors).where(eq(monitors.agentId, agentId))).map((r) => r.name);
  // No known monitors → don't wipe everything (agent may be mid-config); leave as is.
  if (names.length === 0) return;
  await telemetry.delete(unitStates).where(and(eq(unitStates.sourceId, agentId), notInArray(unitStates.entity, names)));
}

/**
 * Purge ALL telemetry for an agent (and its monitors) — live state, events, metrics,
 * logs, uptime, notifications. Used when an agent is deleted so no orphan history
 * lingers. Source-keyed tables go by agentId; metric tables go by monitor id.
 */
export async function purgeAgentTelemetry(telemetry: TelemetryDb, agentId: string, monitorIds: string[]): Promise<void> {
  await telemetry.delete(unitStates).where(eq(unitStates.sourceId, agentId));
  await telemetry.delete(statusEvents).where(eq(statusEvents.sourceId, agentId));
  await telemetry.delete(clientEvents).where(eq(clientEvents.sourceId, agentId));
  await telemetry.delete(uptimeBuckets).where(eq(uptimeBuckets.sourceId, agentId));
  await telemetry.delete(hostMetrics).where(eq(hostMetrics.agentId, agentId));
  await telemetry.delete(pingSamples).where(eq(pingSamples.sourceId, agentId));
  await telemetry.delete(logs).where(eq(logs.sourceId, agentId));
  await telemetry.delete(notifications).where(eq(notifications.sourceId, agentId));
  if (monitorIds.length) {
    await telemetry.delete(dbMetrics).where(inArray(dbMetrics.monitorId, monitorIds));
    await telemetry.delete(snmpMetrics).where(inArray(snmpMetrics.monitorId, monitorIds));
    await telemetry.delete(storageMetrics).where(inArray(storageMetrics.storageId, monitorIds));
    await telemetry.delete(folderMetrics).where(inArray(folderMetrics.storageId, monitorIds));
  }
}
