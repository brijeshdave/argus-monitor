---
title: Data model & conventions
order: 40
---

## Data model (packages/db)

Two Postgres databases, Drizzle schemas under **packages/db/src/{master,telemetry}**.
Migrations via drizzle-kit, applied by `./argus migrate`; seeded by `./argus seed`.

- **master** — users/groups/roles/permissions (+joins), user_attributes, agents,
  agent_keys, monitors, monitor_config, secrets, settings, oidc_providers,
  retention_config, public_config, wall_layouts, wall_devices, ticker_messages.
- **telemetry** — status_events, client_events, host_metrics, db_metrics,
  storage_metrics, logs, audit_log, uptime, notifications.

> Drizzle `timestamp(mode:"string")` returns Postgres format
> (`YYYY-MM-DD HH:MM:SS+00`, a space — not ISO). Normalise to ISO at the DTO
> boundary before it round-trips through `z.string().datetime()`.

## Coding conventions

- **Author header** on every source file, plus a one-line file purpose.
- **TypeScript** strict, no `any` (`unknown` + narrowing). Validate inbound payloads
  at the boundary with zod matching @argus/shared. No business logic in routes — call
  @argus/core.
- **Go** — gofmt/go vet clean; return errors, never panic in the collect/push loop;
  context-cancel everything; keep the hot path allocation-light.
- **React** — function components + hooks; data fetching in hooks, not components;
  Tailwind utilities + shared tokens; big lists paginate server-side.
- **Naming** — camelCase in TS/JSON, snake_case in SQL; map at the DB layer.
- **Imports** — path aliases (`@argus/*` across packages, `@/*` within a package),
  not deep relative paths.
- **DRY + single responsibility**; least third-party dependencies (justify each).

## Tests

vitest / `go test`. The `core` domain is highest-value (diff, authorize, crypto,
uptime, retention); the data layer uses an in-memory PGlite db (`@/testing.js`). TS
tests live in a dedicated `tests/` folder per package/app; Go tests stay colocated
(`*_test.go`).
