/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Per-monitor encrypted credential. Some monitor types carry a secret (a SQL Server
 * connection string, an SMB password). A monitor is a single type, so it has one
 * credential slot stored AES-256-GCM-encrypted in secrets (monitor:<id>:cred) —
 * never in monitors.config, never returned. Delivered decrypted to the bound agent
 * only over the key-authed TLS config pull.
 */
import { eq, inArray } from "drizzle-orm";
import { secrets, type MasterDb } from "@argus/db";
import { decryptSecret, encryptSecret, loadKey } from "@argus/core";

const ref = (monitorId: string): string => `monitor:${monitorId}:cred`;

export async function setMonitorCred(db: MasterDb, monitorId: string, value: string, encKeyB64: string): Promise<void> {
  const ciphertext = encryptSecret(value, loadKey(encKeyB64));
  await db
    .insert(secrets)
    .values({ ref: ref(monitorId), ciphertext })
    .onConflictDoUpdate({ target: secrets.ref, set: { ciphertext, updatedAt: new Date().toISOString() } });
}

export async function getMonitorCred(db: MasterDb, monitorId: string, encKeyB64: string): Promise<string | null> {
  // Try the current ref, then the legacy `:db` ref (pre-generalisation DB monitors).
  for (const r of [ref(monitorId), `monitor:${monitorId}:db`]) {
    const [row] = await db.select().from(secrets).where(eq(secrets.ref, r)).limit(1);
    if (row) return decryptSecret(row.ciphertext, loadKey(encKeyB64));
  }
  return null;
}

export async function deleteMonitorCred(db: MasterDb, monitorId: string): Promise<void> {
  await db.delete(secrets).where(inArray(secrets.ref, [ref(monitorId), `monitor:${monitorId}:db`]));
}

/** The config field a monitor's stored secret should be injected into on delivery. */
export function credFieldFor(config: Record<string, unknown>): string | undefined {
  if (typeof config.credField === "string") return config.credField;
  // Legacy DB monitors marked the cred with `connection:"set"` and used a conn string.
  if (config.connection === "set") return "connectionString";
  return undefined;
}

/** Config fields that are secret — pulled out of config into the encrypted cred slot.
 * The chosen field name is remembered in config.credField so delivery re-injects it. */
export const SECRET_FIELDS = ["connectionString", "password", "community"] as const;
