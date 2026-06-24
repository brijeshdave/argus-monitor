<!-- Argus · Author: Brijesh Dave (https://github.com/brijeshdave) -->
# ADR-0003 — Split databases: master + telemetry on PostgreSQL

**Status:** accepted · **Date:** 2026-06-14

## Context
v1 used a single SQLite database for everything. The platform now needs to scale
metrics/logs/audit independently and switch database engines.

## Decision
Two **logically separate databases** behind a DB-agnostic layer (Drizzle):
- **master** — identity, RBAC, configs, encrypted secrets (low-volume OLTP).
- **telemetry** — metrics, events, logs, audit (high-volume, time-oriented).

**PostgreSQL is the single SQL dialect.** Two interchangeable drivers behind one
typed client: `pg` (a real server, production) and `pglite` (embedded Postgres in
WASM — zero-setup dev + tests, *same dialect* as prod, so no dev/prod drift).
SQLite was dropped: PGlite fills the "no server needed" role with true Postgres
compatibility, and a single dialect keeps the codebase type-safe without a
two-dialect abstraction tax. **TimescaleDB** is the telemetry upgrade path.

> Update: originally SQLite was the dev driver. Replaced with PGlite for
> the reasons above. One schema, one query API, full type-safety everywhere.

## Rationale
- Telemetry growth must never threaten the source of truth.
- Postgres offers JSONB, partitioning, and a clean Timescale upgrade.
- DB-agnostic domain code keeps engine choice a config decision.

## Consequences
- Two connection pools/migration sets to manage (one per DB).
- Cross-DB joins are avoided by design; the backend composes data in `@argus/core`.

## Recommendation (what to use)
- **Dev/test:** PGlite (embedded, zero setup — `DB_DRIVER=pglite`).
- **Production (typical):** PostgreSQL 17 server for both DBs (`DB_DRIVER=pg`).
- **High-volume metrics / long retention:** PostgreSQL + TimescaleDB for telemetry.
