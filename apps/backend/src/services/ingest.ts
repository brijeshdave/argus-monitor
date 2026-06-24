/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Telemetry ingest (HTTP slice): persists a pushed snapshot's host metrics, status
 * events and logs into the telemetry DB. Event derivation/diffing is handled by the diff service;
 * here we durably record what the agent reports.
 */
import { hostMetrics, logs, processMetrics, statusEvents, type TelemetryDb } from "@argus/db";
import type { AgentIngestRequest } from "@argus/shared";
import { processUnits } from "@/services/pipeline.js";

export async function ingest(db: TelemetryDb, agentId: string, payload: AgentIngestRequest): Promise<void> {
  // Derive events/uptime/notifications from per-monitor unit samples.
  if (payload.units?.length) {
    await processUnits(db, agentId, payload.units);

    // Persist per-unit CPU/memory as a time series (for resource reports). Any
    // unit that reports a cpu or memory figure contributes one point per push.
    const points = payload.units
      .filter((u) => u.meta && (u.meta.cpuPercent != null || u.meta.memMB != null))
      .map((u) => ({ sourceId: agentId, entity: u.entity, cpuPct: u.meta!.cpuPercent ?? null, memMb: u.meta!.memMB ?? null }));
    if (points.length) await db.insert(processMetrics).values(points);
  }

  if (payload.metrics) {
    const m = payload.metrics;
    await db.insert(hostMetrics).values({
      agentId,
      cpuPct: m.cpuPct ?? null,
      memPct: m.memPct ?? null,
      memUsedMb: m.memUsedMb ?? null,
      extra: m.extra ?? null,
    });
  }

  if (payload.events?.length) {
    await db.insert(statusEvents).values(
      payload.events.map((e) => ({
        sourceId: agentId,
        entity: e.entity,
        type: e.type,
        oldStatus: e.oldStatus ?? null,
        newStatus: e.newStatus ?? null,
        detail: e.detail ?? null,
      })),
    );
  }

  if (payload.logs?.length) {
    await db.insert(logs).values(
      payload.logs.map((l) => ({
        sourceId: agentId,
        category: l.category,
        level: l.level,
        message: l.message,
        context: l.context ?? null,
      })),
    );
  }
}
