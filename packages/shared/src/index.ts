/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Barrel for all shared contracts. This package is the SINGLE source of truth
 * for every wire type exchanged between agent ⇄ backend ⇄ frontend. The Go agent
 * marshals to the same JSON shapes (camelCase keys, ISO-8601 UTC timestamps).
 *
 * Contract modules, grouped by domain:
 *   identity   — rbac, config, crypto envelopes
 *   agent      — control-plane messages (register/heartbeat/command)
 *   telemetry  — monitor samples, snapshots, events, live state
 */
export * from "./common.js";
export * from "./rbac.js";
export * from "./agent.js";
export * from "./oidc.js";
export * from "./monitor.js";
export * from "./live.js";
export * from "./wallboard.js";
export * from "./public.js";
export * from "./report.js";
export * from "./session.js";
export * from "./twofa.js";
export * from "./backup.js";
export * from "./docs.js";
