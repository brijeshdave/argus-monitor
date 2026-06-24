<!-- Argus · Author: Brijesh Dave (https://github.com/brijeshdave) -->
# ADR-0006 — ORM: Drizzle

**Status:** accepted · **Date:** 2026-06-14

## Context
v1 used hand-written SQL via `better-sqlite3`. The platform needs type-safe,
migration-driven, multi-engine data access (SQLite/Postgres/MySQL) while keeping
the dependency footprint small.

## Decision
Use **Drizzle ORM** + **drizzle-kit** migrations, one schema/config per database
(master, telemetry).

## Rationale
- Lightweight, SQL-first, fully typed — minimal runtime overhead and no heavy
  abstraction, consistent with "least third-party packages".
- First-class multi-dialect support matches ADR-0003.
- Generated, reviewable SQL migrations fit an auditable system of record.

## Consequences
- Two drizzle configs and migration folders.
- Domain logic stays in `@argus/core` (DB-agnostic); Drizzle lives only in `@argus/db`.
