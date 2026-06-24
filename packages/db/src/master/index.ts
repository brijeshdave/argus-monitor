/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * MASTER database public surface: the schema plus a single factory that opens a
 * typed connection for the active driver (pg / pglite).
 */
import { connect, type Connection, type Database } from "@/client.js";
import { readDbEnv, type DbEnv } from "@/env.js";
import { masterSchema } from "@/master/schema.js";

export * from "@/master/schema.js";

export type MasterSchema = typeof masterSchema;
export type MasterDb = Database<MasterSchema>;

/** Open a connection to the master database using resolved environment config. */
export function createMasterConnection(env: DbEnv = readDbEnv()): Connection<MasterSchema> {
  return connect({
    driver: env.driver,
    schema: masterSchema,
    url: env.masterUrl,
    pgliteDataDir: `${env.pgliteDir}/master`,
  });
}
