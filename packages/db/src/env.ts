/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Database environment resolution. Argus runs TWO logically separate databases:
 *   • master    — identity, RBAC, configs, encrypted secrets (low volume, OLTP)
 *   • telemetry — metrics, events, logs, audit (high volume, time-series-ish)
 *
 * Single SQL dialect: PostgreSQL (ADR-0003).
 *   • driver "pg"      — a real PostgreSQL server (production / Docker).
 *   • driver "pglite"  — embedded Postgres (WASM), zero-setup dev + tests. Same
 *                        dialect as prod, so there is no dev/prod drift.
 * Keeping the two databases separate lets telemetry scale/swap (→ TimescaleDB)
 * without touching the source-of-truth master store.
 */
export type DbDriver = "pg" | "pglite";

export interface DbEnv {
  driver: DbDriver;
  masterUrl: string;
  telemetryUrl: string;
  /** Directory for PGlite's on-disk data (ignored for in-memory `:memory:`). */
  pgliteDir: string;
}

export function readDbEnv(env: NodeJS.ProcessEnv = process.env): DbEnv {
  const driver = (env.DB_DRIVER ?? "pglite") as DbDriver;
  return {
    driver,
    masterUrl: env.MASTER_DATABASE_URL ?? "",
    telemetryUrl: env.TELEMETRY_DATABASE_URL ?? "",
    pgliteDir: env.PGLITE_DIR ?? env.DATA_DIR ?? "./data/pglite",
  };
}
