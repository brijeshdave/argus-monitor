/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Durable server→agent command queue. Commands persist (pending) and are pushed
 * over the control socket when the agent is connected; offline agents receive
 * them on next connect. The agent acks each command after applying it.
 */
import { and, eq } from "drizzle-orm";
import { agentCommands, type MasterDb } from "@argus/db";
import type { AgentCommandDTO, AgentCommandType } from "@argus/shared";
import type { AgentHub } from "@/services/agent-hub.js";

type Row = typeof agentCommands.$inferSelect;

const toDTO = (r: Row): AgentCommandDTO => ({
  id: r.id,
  agentId: r.agentId,
  type: r.type as AgentCommandType,
  payload: r.payload ?? null,
  status: r.status as AgentCommandDTO["status"],
  createdAt: r.createdAt,
});

export async function enqueueCommand(
  db: MasterDb,
  agentId: string,
  type: AgentCommandType,
  payload?: Record<string, unknown>,
): Promise<AgentCommandDTO> {
  const [row] = await db.insert(agentCommands).values({ agentId, type, payload: payload ?? null }).returning();
  if (!row) throw new Error("failed to enqueue command");
  return toDTO(row);
}

export async function markSent(db: MasterDb, id: string): Promise<void> {
  await db.update(agentCommands).set({ status: "sent", sentAt: new Date().toISOString() }).where(eq(agentCommands.id, id));
}

export async function markAcked(db: MasterDb, id: string): Promise<void> {
  await db.update(agentCommands).set({ status: "acked", ackedAt: new Date().toISOString() }).where(eq(agentCommands.id, id));
}

export async function listCommands(db: MasterDb, agentId: string): Promise<AgentCommandDTO[]> {
  return (await db.select().from(agentCommands).where(eq(agentCommands.agentId, agentId))).map(toDTO);
}

export async function listUndelivered(db: MasterDb, agentId: string): Promise<AgentCommandDTO[]> {
  const rows = await db
    .select()
    .from(agentCommands)
    .where(and(eq(agentCommands.agentId, agentId), eq(agentCommands.status, "pending")));
  return rows.map(toDTO);
}

/** Enqueue and immediately push if the agent is online (marking it sent). */
export async function dispatchCommand(
  db: MasterDb,
  hub: AgentHub,
  agentId: string,
  type: AgentCommandType,
  payload?: Record<string, unknown>,
): Promise<AgentCommandDTO> {
  const command = await enqueueCommand(db, agentId, type, payload);
  if (hub.send(agentId, { t: "command", command })) {
    await markSent(db, command.id);
  }
  return command;
}

/** Flush all pending commands to a freshly-connected agent. */
export async function flushPending(db: MasterDb, hub: AgentHub, agentId: string): Promise<void> {
  for (const command of await listUndelivered(db, agentId)) {
    if (hub.send(agentId, { t: "command", command })) await markSent(db, command.id);
  }
}
