/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Database client factory. One SQL dialect (PostgreSQL) with two interchangeable
 * drivers behind a single typed surface:
 *   • "pg"     → node-postgres Pool against a real server (production).
 *   • "pglite" → embedded Postgres (WASM) for zero-setup dev + tests.
 *
 * Both drivers yield a Drizzle `PgDatabase`, so all downstream domain/query code
 * is written once and is driver-agnostic. The schema is injected by the caller
 * (`@/master`, `@/telemetry`) so this module stays decoupled from table shapes.
 */
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import type { DbDriver } from "@/env.js";

/** Unified, driver-agnostic database handle (typed by the injected schema). */
export type Database<TSchema extends Record<string, unknown>> = NodePgDatabase<TSchema>;

export interface ConnectOptions<TSchema extends Record<string, unknown>> {
  driver: DbDriver;
  schema: TSchema;
  /** pg: connection URL. */
  url?: string;
  /** pglite: data directory, or omitted/":memory:" for an in-memory database. */
  pgliteDataDir?: string;
}

export interface Connection<TSchema extends Record<string, unknown>> {
  db: Database<TSchema>;
  /** Release pools / close the embedded engine. */
  close: () => Promise<void>;
}

/**
 * Open a connection. The returned `db` is uniformly typed regardless of driver;
 * the PGlite instance is surfaced through the node-postgres database type because
 * both share the Drizzle Postgres query API.
 */
export function connect<TSchema extends Record<string, unknown>>(
  opts: ConnectOptions<TSchema>,
): Connection<TSchema> {
  if (opts.driver === "pg") {
    if (!opts.url) throw new Error("connect(pg): a connection url is required");
    const pool = new Pool({ connectionString: opts.url });
    const db = drizzlePg(pool, { schema: opts.schema }) as Database<TSchema>;
    return { db, close: () => pool.end() };
  }

  // pglite — embedded; no directory means in-memory (ideal for tests).
  const client = new PGlite(opts.pgliteDataDir && opts.pgliteDataDir !== ":memory:" ? opts.pgliteDataDir : undefined);
  const db = drizzlePglite(client, { schema: opts.schema }) as unknown as Database<TSchema>;
  return { db, close: () => client.close() };
}
