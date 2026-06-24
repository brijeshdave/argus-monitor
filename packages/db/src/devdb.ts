/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Development-database tooling (wired to `./argus dev-db`). Two operations against
 * a SEPARATE pair of databases (argus_master_dev / argus_telemetry_dev) that live
 * in the same Postgres as production:
 *
 *   wipe                         truncate ALL data in both dev databases
 *   copy [--since ISO --until ISO]
 *                                replace dev with a clone of production: master
 *                                (config) in full + telemetry (metrics/logs/events)
 *                                within the given time range (default: last 7 days)
 *
 * Production is opened from the usual *_DATABASE_URL env; dev from DEV_*_DATABASE_URL.
 * This is a dev convenience — it is destructive to the DEV databases only and never
 * writes to production.
 */
import { fileURLToPath } from "node:url";
import { and, gte, lte, type AnyColumn } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { createMasterConnection } from "@/master/index.js";
import { createTelemetryConnection } from "@/telemetry/index.js";
import { readDbEnv, type DbEnv } from "@/env.js";
import {
  exportDatabases,
  importDatabases,
  MASTER_TABLE_ORDER,
  TELEMETRY_TABLE_ORDER,
} from "@/backup.js";

const INSERT_CHUNK = 500;

/** The timestamp column used to time-range each telemetry table (default "ts"). */
const TIME_COLUMN: Record<string, string> = {
  uptimeBuckets: "bucketStart",
  unitStates: "updatedAt",
};

/** Build the dev DbEnv from prod env + DEV_*_DATABASE_URL overrides. */
function devEnv(prod: DbEnv): DbEnv {
  const masterUrl = process.env.DEV_MASTER_DATABASE_URL ?? "";
  const telemetryUrl = process.env.DEV_TELEMETRY_DATABASE_URL ?? "";
  if (prod.driver !== "pg" || !masterUrl || !telemetryUrl) {
    throw new Error("dev-db requires DB_DRIVER=pg and DEV_MASTER_DATABASE_URL + DEV_TELEMETRY_DATABASE_URL");
  }
  return { ...prod, masterUrl, telemetryUrl };
}

/** Parse `--since`/`--until` (ISO) from argv; defaults to the last 7 days. */
function parseRange(argv: string[]): { since: string; until: string } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const until = get("--until") ?? new Date().toISOString();
  const since = get("--since") ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (Number.isNaN(Date.parse(since)) || Number.isNaN(Date.parse(until))) {
    throw new Error(`invalid --since/--until (use ISO-8601): since=${since} until=${until}`);
  }
  return { since, until };
}

/** Delete every row in both dev databases (children-first to respect FKs). */
async function wipe(): Promise<void> {
  const env = devEnv(readDbEnv());
  const m = createMasterConnection(env);
  const t = createTelemetryConnection(env);
  try {
    for (let i = TELEMETRY_TABLE_ORDER.length - 1; i >= 0; i -= 1) await t.db.delete(TELEMETRY_TABLE_ORDER[i]!.table);
    for (let i = MASTER_TABLE_ORDER.length - 1; i >= 0; i -= 1) await m.db.delete(MASTER_TABLE_ORDER[i]!.table);
    // eslint-disable-next-line no-console
    console.log("[dev-db] wiped argus_master_dev + argus_telemetry_dev");
  } finally {
    await m.close();
    await t.close();
  }
}

/** Insert rows into a dev table in FK-safe, chunked batches. */
async function insertChunked(db: { insert: (t: PgTable) => { values: (v: Record<string, unknown>[]) => Promise<unknown> } }, table: PgTable, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db.insert(table).values(rows.slice(i, i + INSERT_CHUNK));
  }
}

/** Clone production → dev: master in full, telemetry within [since, until]. */
async function copy(argv: string[]): Promise<void> {
  const { since, until } = parseRange(argv);
  const prod = readDbEnv();
  const dev = devEnv(prod);

  const prodM = createMasterConnection(prod);
  const prodT = createTelemetryConnection(prod);
  const devM = createMasterConnection(dev);
  const devT = createTelemetryConnection(dev);
  try {
    // 1) Master (config) — full clone via the backup export/import path.
    const configBundle = await exportDatabases(prodM.db, prodT.db, "config");
    await importDatabases(devM.db, devT.db, configBundle);
    // eslint-disable-next-line no-console
    console.log("[dev-db] copied master (config) in full");

    // 2) Telemetry — clear dev, then copy each table's rows within the time range.
    for (let i = TELEMETRY_TABLE_ORDER.length - 1; i >= 0; i -= 1) await devT.db.delete(TELEMETRY_TABLE_ORDER[i]!.table);
    let total = 0;
    for (const { name, table } of TELEMETRY_TABLE_ORDER) {
      const col = (table as unknown as Record<string, AnyColumn>)[TIME_COLUMN[name] ?? "ts"];
      const rows = col
        ? ((await prodT.db.select().from(table).where(and(gte(col, since), lte(col, until)))) as Record<string, unknown>[])
        : ((await prodT.db.select().from(table)) as Record<string, unknown>[]);
      if (rows.length) await insertChunked(devT.db, table, rows);
      total += rows.length;
    }
    // eslint-disable-next-line no-console
    console.log(`[dev-db] copied telemetry: ${total} rows in [${since} … ${until}]`);
  } finally {
    await prodM.close();
    await prodT.close();
    await devM.close();
    await devT.close();
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , cmd, ...rest] = process.argv;
  const run = cmd === "wipe" ? wipe() : cmd === "copy" ? copy(rest) : Promise.reject(new Error(`usage: devdb.js <wipe|copy> [--since ISO --until ISO]`));
  run
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[dev-db] failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
