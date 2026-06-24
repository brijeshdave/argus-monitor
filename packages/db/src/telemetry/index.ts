/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * TELEMETRY database public surface: the schema plus a single factory that opens
 * a typed connection for the active driver (pg / pglite).
 */
import { connect, type Connection, type Database } from "@/client.js";
import { readDbEnv, type DbEnv } from "@/env.js";
import { telemetrySchema } from "@/telemetry/schema.js";

export * from "@/telemetry/schema.js";

export type TelemetrySchema = typeof telemetrySchema;
export type TelemetryDb = Database<TelemetrySchema>;

/** Open a connection to the telemetry database using resolved environment config. */
export function createTelemetryConnection(env: DbEnv = readDbEnv()): Connection<TelemetrySchema> {
  return connect({
    driver: env.driver,
    schema: telemetrySchema,
    url: env.telemetryUrl,
    pgliteDataDir: `${env.pgliteDir}/telemetry`,
  });
}
