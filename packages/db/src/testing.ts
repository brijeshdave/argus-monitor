/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Test helpers: spin up an ephemeral, in-memory PGlite database with migrations
 * applied. Because PGlite is real Postgres, tests exercise the exact dialect used
 * in production. Reused by every data-layer test (DRY).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { masterSchema, type MasterDb } from "@/master/index.js";
import { telemetrySchema, type TelemetryDb } from "@/telemetry/index.js";

const here = dirname(fileURLToPath(import.meta.url));

interface Ephemeral<TDb> {
  db: TDb;
  close: () => Promise<void>;
}

/** In-memory master database with the master migrations applied. */
export async function createEphemeralMasterDb(): Promise<Ephemeral<MasterDb>> {
  const client = new PGlite();
  const db = drizzle(client, { schema: masterSchema }) as unknown as MasterDb;
  await migrate(db, { migrationsFolder: resolve(here, "../migrations/master") });
  return { db, close: () => client.close() };
}

/** In-memory telemetry database with the telemetry migrations applied. */
export async function createEphemeralTelemetryDb(): Promise<Ephemeral<TelemetryDb>> {
  const client = new PGlite();
  const db = drizzle(client, { schema: telemetrySchema }) as unknown as TelemetryDb;
  await migrate(db, { migrationsFolder: resolve(here, "../migrations/telemetry") });
  return { db, close: () => client.close() };
}
