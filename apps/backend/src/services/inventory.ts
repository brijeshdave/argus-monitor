/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Host inventory store: the latest discoverable services/processes per agent,
 * upserted from the agent's push and read by the monitor pick-list. One row per
 * agent — this is "current state", not time-series.
 */
import { eq } from "drizzle-orm";
import { hostInventory, type TelemetryDb } from "@argus/db";
import type { AgentInventory, HostInventoryDTO, InventoryItem } from "@argus/shared";

/** Replace an agent's inventory with the freshly-discovered snapshot. */
export async function saveInventory(db: TelemetryDb, agentId: string, inv: AgentInventory): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(hostInventory)
    .values({ agentId, services: inv.services, processes: inv.processes, collectedAt: now })
    .onConflictDoUpdate({
      target: hostInventory.agentId,
      set: { services: inv.services, processes: inv.processes, collectedAt: now },
    });
}

/** Latest inventory for an agent; empty lists when nothing has been collected yet. */
export async function getInventory(db: TelemetryDb, agentId: string): Promise<HostInventoryDTO> {
  const [row] = await db.select().from(hostInventory).where(eq(hostInventory.agentId, agentId)).limit(1);
  return {
    services: (row?.services as InventoryItem[] | null) ?? [],
    processes: (row?.processes as InventoryItem[] | null) ?? [],
    collectedAt: row?.collectedAt ?? null,
  };
}

/** Prune an agent's inventory row (called when the agent is deleted). */
export async function deleteInventory(db: TelemetryDb, agentId: string): Promise<void> {
  await db.delete(hostInventory).where(eq(hostInventory.agentId, agentId));
}
