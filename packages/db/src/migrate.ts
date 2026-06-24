/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Migration runner for both databases. Applies the drizzle-kit-generated SQL in
 * migrations/master and migrations/telemetry against the active driver. Single
 * responsibility: it only migrates — schema lives in the schema files, seed data
 * lives in seed.ts.
 *
 * Usage:  pnpm --filter @argus/db migrate   (wired to `./argus migrate`)
 */
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { readDbEnv, type DbEnv } from "@/env.js";

interface MigrateTarget {
  label: string;
  url: string;
  folder: string;
  pgliteDir: string;
}

/** Migrate one database with the driver-appropriate migrator. */
async function migrateOne(target: MigrateTarget, env: DbEnv): Promise<void> {
  if (env.driver === "pg") {
    if (!target.url) throw new Error(`migrate(${target.label}): a connection url is required for the pg driver`);
    const pool = new Pool({ connectionString: target.url });
    try {
      await migratePg(drizzlePg(pool), { migrationsFolder: target.folder });
    } finally {
      await pool.end();
    }
  } else {
    const client = new PGlite(target.pgliteDir);
    try {
      await migratePglite(drizzlePglite(client), { migrationsFolder: target.folder });
    } finally {
      await client.close();
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[migrate] ${target.label} ✓`);
}

/** Apply all pending migrations to both databases, in order. */
export async function runMigrations(env: DbEnv = readDbEnv()): Promise<void> {
  await migrateOne({ label: "master", url: env.masterUrl, folder: "./migrations/master", pgliteDir: `${env.pgliteDir}/master` }, env);
  await migrateOne({ label: "telemetry", url: env.telemetryUrl, folder: "./migrations/telemetry", pgliteDir: `${env.pgliteDir}/telemetry` }, env);
}

// Run when invoked directly (node dist/migrate.js), not when imported.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[migrate] failed:", err);
      process.exit(1);
    });
}
