/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Domain core: framework-free business logic that the backend and workers call.
 * Keeping it pure (no Fastify, no DB driver) makes it the highest-value unit-test
 * surface. Modules added per phase:
 *   crypto     — AES-256-GCM secret envelopes; password (scrypt)
 *   authz      — authorize (RBAC/ABAC), audit redaction, protection guards
 *   telemetry  — diff (event derivation), state (overall rollup), uptime
 */
export const ARGUS_CORE_VERSION = "1.0.0";

export * from "@/crypto.js";
export * from "@/password.js";
export * from "@/totp.js";
export * from "@/authorize.js";
export * from "@/audit.js";
export * from "@/protection.js";
export * from "@/state.js";
export * from "@/diff.js";
export * from "@/uptime.js";
export * from "@/storage.js";
export * from "@/ticker.js";
