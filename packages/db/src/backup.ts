/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Driver-agnostic logical backup/restore for both databases. Works identically on
 * the `pg` and `pglite` drivers because it only uses Drizzle's query builder.
 *
 * The table order is declared explicitly (parents before children) so the restore
 * can DELETE in reverse (children first) and INSERT in forward order (parents
 * first) without tripping foreign-key constraints. The keys in the bundle are the
 * schema export names, so a bundle is self-describing and version-stamped.
 */
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  agentCommands,
  agentKeys,
  agents,
  groupRoles,
  groups,
  monitors,
  oidcProviders,
  permissions,
  publicConfig,
  refreshTokens,
  retentionConfig,
  rolePermissions,
  roles,
  secrets,
  settings,
  tickerMessages,
  userAttributes,
  userGroups,
  users,
  wallDeviceGroups,
  wallDevices,
  wallLayouts,
} from "@/master/schema.js";
import {
  auditLog,
  clientEvents,
  dbMetrics,
  hostMetrics,
  logs,
  notifications,
  statusEvents,
  storageMetrics,
  unitStates,
  uptimeBuckets,
} from "@/telemetry/schema.js";
import type { MasterDb } from "@/master/index.js";
import type { TelemetryDb } from "@/telemetry/index.js";

/** A schema table paired with the export name used as its bundle key. */
export interface OrderedTable {
  name: string;
  /** The Drizzle pg table object (heterogeneous across the ordered list). */
  table: PgTable;
}

/**
 * MASTER tables in dependency order (parents first). Identity → RBAC catalogue →
 * RBAC joins → agents/secrets/config → tokens/commands → wallboards → ticker →
 * public config.
 */
export const MASTER_TABLE_ORDER: readonly OrderedTable[] = [
  { name: "users", table: users },
  { name: "groups", table: groups },
  { name: "roles", table: roles },
  { name: "permissions", table: permissions },
  { name: "rolePermissions", table: rolePermissions },
  { name: "groupRoles", table: groupRoles },
  { name: "userGroups", table: userGroups },
  { name: "userAttributes", table: userAttributes },
  { name: "agents", table: agents },
  { name: "agentKeys", table: agentKeys },
  { name: "secrets", table: secrets },
  { name: "settings", table: settings },
  { name: "oidcProviders", table: oidcProviders },
  { name: "monitors", table: monitors },
  { name: "retentionConfig", table: retentionConfig },
  { name: "refreshTokens", table: refreshTokens },
  { name: "agentCommands", table: agentCommands },
  { name: "wallLayouts", table: wallLayouts },
  { name: "wallDeviceGroups", table: wallDeviceGroups },
  { name: "wallDevices", table: wallDevices },
  { name: "tickerMessages", table: tickerMessages },
  { name: "publicConfig", table: publicConfig },
] as const;

/** TELEMETRY tables in dependency order (parents first; all are FK-free here). */
export const TELEMETRY_TABLE_ORDER: readonly OrderedTable[] = [
  { name: "unitStates", table: unitStates },
  { name: "statusEvents", table: statusEvents },
  { name: "clientEvents", table: clientEvents },
  { name: "hostMetrics", table: hostMetrics },
  { name: "dbMetrics", table: dbMetrics },
  { name: "storageMetrics", table: storageMetrics },
  { name: "logs", table: logs },
  { name: "auditLog", table: auditLog },
  { name: "uptimeBuckets", table: uptimeBuckets },
  { name: "notifications", table: notifications },
] as const;

/** What a bundle captures: both DBs, master only (config), or telemetry only (data). */
export type BackupScope = "all" | "config" | "data";

/**
 * A self-describing logical snapshot. `master`/`telemetry` are OPTIONAL so a scoped
 * backup can omit a database entirely — and a restore then leaves that database
 * untouched (a config-only restore never wipes telemetry, and vice-versa).
 */
export interface BackupBundle {
  version: 1;
  createdAt: string;
  scope?: BackupScope;
  master?: Record<string, unknown[]>;
  telemetry?: Record<string, unknown[]>;
}

const INSERT_CHUNK = 500;

/** Read every table of one database into a `name → rows` map. */
async function dumpTables(
  // The Drizzle db is typed by its schema; `select().from(table)` is uniform.
  db: MasterDb | TelemetryDb,
  order: readonly OrderedTable[],
): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const { name, table } of order) {
    out[name] = await db.select().from(table);
  }
  return out;
}

/**
 * Export the databases selected by `scope` into a single in-memory bundle:
 *   "all"    → master + telemetry
 *   "config" → master only
 *   "data"   → telemetry only
 */
export async function exportDatabases(
  master: MasterDb,
  telemetry: TelemetryDb,
  scope: BackupScope = "all",
): Promise<BackupBundle> {
  const bundle: BackupBundle = { version: 1, createdAt: new Date().toISOString(), scope };
  if (scope !== "data") bundle.master = await dumpTables(master, MASTER_TABLE_ORDER);
  if (scope !== "config") bundle.telemetry = await dumpTables(telemetry, TELEMETRY_TABLE_ORDER);
  return bundle;
}

/**
 * Stream a scoped export straight to a file, serialising ONE ROW AT A TIME. This
 * avoids building the whole bundle as a single JS string (which overflows V8's
 * ~512 MB string limit once a high-volume telemetry table is large), so backups of
 * any size succeed. The output is byte-identical in shape to {@link exportDatabases}
 * + JSON.stringify, so {@link importDatabases} restores it unchanged.
 */
export async function exportDatabasesToFile(
  master: MasterDb,
  telemetry: TelemetryDb,
  scope: BackupScope,
  filePath: string,
): Promise<{ createdAt: string; bytes: number }> {
  await mkdir(dirname(filePath), { recursive: true });
  const createdAt = new Date().toISOString();
  const ws = createWriteStream(filePath, { encoding: "utf8" });
  let bytes = 0;
  let streamErr: Error | null = null;
  ws.on("error", (e) => { streamErr = e; });

  const write = (s: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (streamErr) return reject(streamErr);
      bytes += Buffer.byteLength(s);
      if (ws.write(s)) resolve();
      else ws.once("drain", resolve);
    });

  const writeDb = async (db: MasterDb | TelemetryDb, order: readonly OrderedTable[]): Promise<void> => {
    await write("{");
    for (let i = 0; i < order.length; i += 1) {
      const { name, table } = order[i]!;
      await write(`${i ? "," : ""}${JSON.stringify(name)}:[`);
      const rows = await db.select().from(table);
      for (let j = 0; j < rows.length; j += 1) await write(`${j ? "," : ""}${JSON.stringify(rows[j])}`);
      await write("]");
    }
    await write("}");
  };

  await write(`{"version":1,"createdAt":${JSON.stringify(createdAt)},"scope":${JSON.stringify(scope)}`);
  if (scope !== "data") { await write(`,"master":`); await writeDb(master, MASTER_TABLE_ORDER); }
  if (scope !== "config") { await write(`,"telemetry":`); await writeDb(telemetry, TELEMETRY_TABLE_ORDER); }
  await write("}");

  await new Promise<void>((resolve, reject) => {
    ws.end(() => (streamErr ? reject(streamErr) : resolve()));
  });
  return { createdAt, bytes };
}

/**
 * Restore one database from a bundle slice. DELETE children-first (reverse order),
 * then INSERT parents-first (forward order) so foreign keys are never violated.
 * Tables absent from the bundle are left untouched on insert but still cleared on
 * delete only if present — i.e. missing keys are skipped entirely.
 */
async function restoreOne(
  db: MasterDb | TelemetryDb,
  order: readonly OrderedTable[],
  data: Record<string, unknown[]>,
): Promise<void> {
  // DELETE: children first → reverse dependency order.
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const entry = order[i];
    if (entry === undefined) continue;
    await db.delete(entry.table);
  }

  // INSERT: parents first → forward dependency order, chunked.
  for (const { name, table } of order) {
    const rows = data[name];
    if (!rows || rows.length === 0) continue;
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK) as Record<string, unknown>[];
      await db.insert(table).values(chunk);
    }
  }
}

/**
 * Restore BOTH databases from a bundle. Each database's restore is wrapped so a
 * failure surfaces with context (no partial silent success). Per-table FK ordering
 * is handled by {@link restoreOne}.
 */
export async function importDatabases(
  master: MasterDb,
  telemetry: TelemetryDb,
  bundle: BackupBundle,
): Promise<void> {
  // A database the bundle OMITS is left completely untouched (no delete, no insert)
  // so a scoped restore only replaces what the backup actually captured.
  if (bundle.master !== undefined) {
    try {
      await restoreOne(master, MASTER_TABLE_ORDER, bundle.master);
    } catch (err) {
      throw new Error(`master restore failed: ${(err as Error).message}`, { cause: err });
    }
  }
  if (bundle.telemetry !== undefined) {
    try {
      await restoreOne(telemetry, TELEMETRY_TABLE_ORDER, bundle.telemetry);
    } catch (err) {
      throw new Error(`telemetry restore failed: ${(err as Error).message}`, { cause: err });
    }
  }
}
