/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Connection-key management. A key is shown to the operator exactly once; only its
 * SHA-256 hash is used for lookups, and the full value is also kept AES-256-GCM
 * encrypted (for optional re-display/rotation). Agents authenticate with the key.
 */
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { agentKeys, secrets, type MasterDb } from "@argus/db";
import { encryptSecret, loadKey } from "@argus/core";
import type { ConnectionKeyDTO } from "@argus/shared";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

export type AgentKeyRow = typeof agentKeys.$inferSelect;

const toDTO = (r: AgentKeyRow): ConnectionKeyDTO => ({
  id: r.id,
  label: r.label,
  agentId: r.agentId,
  disabled: r.disabled,
  lastUsedAt: r.lastUsedAt,
  createdAt: r.createdAt,
});

export async function mintConnectionKey(
  db: MasterDb,
  input: { label: string },
  encryptionKeyBase64: string,
): Promise<{ keyId: string; key: string }> {
  const key = `argus_${randomBytes(24).toString("base64url")}`;
  const [row] = await db
    .insert(agentKeys)
    .values({ label: input.label, keyHash: sha256(key), disabled: false })
    .returning();
  if (!row) throw new Error("failed to create connection key");

  // Store the full key encrypted for optional re-display/rotation.
  const envelope = encryptSecret(key, loadKey(encryptionKeyBase64));
  const ref = `agentkey:${row.id}`;
  await db.insert(secrets).values({ ref, ciphertext: envelope }).onConflictDoNothing({ target: secrets.ref });
  await db.update(agentKeys).set({ secretRef: ref }).where(eq(agentKeys.id, row.id));

  return { keyId: row.id, key };
}

export async function listConnectionKeys(db: MasterDb): Promise<ConnectionKeyDTO[]> {
  const rows = await db.select().from(agentKeys);
  return rows.map(toDTO);
}

export async function revokeConnectionKey(db: MasterDb, keyId: string): Promise<boolean> {
  const [row] = await db.update(agentKeys).set({ disabled: true }).where(eq(agentKeys.id, keyId)).returning();
  return Boolean(row);
}

/** Resolve a presented raw key to its (enabled) row, or null. */
export async function resolveAgentKey(db: MasterDb, rawKey: string): Promise<AgentKeyRow | null> {
  const [row] = await db.select().from(agentKeys).where(eq(agentKeys.keyHash, sha256(rawKey))).limit(1);
  if (!row || row.disabled) return null;
  return row;
}

export async function touchKeyUsage(db: MasterDb, keyId: string): Promise<void> {
  await db.update(agentKeys).set({ lastUsedAt: new Date().toISOString() }).where(eq(agentKeys.id, keyId));
}
