/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Public surface of the data layer: environment resolution, the driver-agnostic
 * client factory, the two database schemas + connection factories, retention
 * primitives, the seed building blocks, and test helpers.
 */
export * from "@/env.js";
export * from "@/client.js";
export * from "@/helpers.js";
export * from "@/master/index.js";
export * from "@/telemetry/index.js";
export * from "@/retention.js";
export * from "@/backup.js";
export * from "@/testing.js";

// Seed building blocks (composed by seed.ts; also used by tests).
export { seedRbac } from "@/seed/rbac.js";
export { seedOwner, type SeedOwnerOptions, type SeedOwnerResult } from "@/seed/owner.js";
export { seedRetentionDefaults, RETENTION_DATA_TYPES } from "@/seed/retention.js";
