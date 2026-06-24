/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Client metadata: an admin's per-IP custom name (overrides the agent-resolved
 * hostname) + free-text description, applied when rendering connected clients.
 */
import { eq } from "drizzle-orm";
import { clientMeta, type MasterDb } from "@argus/db";
import type { ClientMetaDTO, ClientMetaInput } from "@argus/shared";

type Row = typeof clientMeta.$inferSelect;

const toDTO = (r: Row): ClientMetaDTO => ({
  ip: r.ip,
  hostname: r.hostname,
  description: r.description,
  updatedAt: r.updatedAt,
});

export async function listClientMeta(db: MasterDb): Promise<ClientMetaDTO[]> {
  return (await db.select().from(clientMeta)).map(toDTO);
}

/** Upsert the annotation for one IP. */
export async function upsertClientMeta(db: MasterDb, ip: string, input: ClientMetaInput, updatedBy: string | null): Promise<ClientMetaDTO> {
  const now = new Date().toISOString();
  const values = { ip, hostname: input.hostname ?? null, description: input.description ?? null, updatedBy, updatedAt: now };
  const [row] = await db
    .insert(clientMeta)
    .values(values)
    .onConflictDoUpdate({ target: clientMeta.ip, set: { hostname: values.hostname, description: values.description, updatedBy, updatedAt: now } })
    .returning();
  if (!row) throw new Error("failed to upsert client meta");
  return toDTO(row);
}

export async function deleteClientMeta(db: MasterDb, ip: string): Promise<boolean> {
  const [row] = await db.delete(clientMeta).where(eq(clientMeta.ip, ip)).returning();
  return Boolean(row);
}
