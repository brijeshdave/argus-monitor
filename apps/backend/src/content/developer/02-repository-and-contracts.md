---
title: Repository & contracts
order: 20
---

## Repository layout

```text
apps/
  backend/   Fastify API + WS hub + ingest (thin routes)
  workers/   BullMQ job processors (optional separate host)
  frontend/  React SPA (dashboard/admin/wallboard/public/docs)
packages/
  shared/    contracts + zod (single source of truth)
  db/        Drizzle schemas/clients/migrations/seed (master+telemetry)
  core/      framework-free domain logic (diff/authorize/audit/crypto…)
agent/       Go agent (separate toolchain)
deploy/      docker-compose · k8s · postgres init
docs/        ARCHITECTURE · adr/ · security
```

> Internal working files (the lean internal spec) live in the gitignored
> `.private/` folder and must never be committed or shipped in an image.

## Contracts (packages/shared)

All wire/API shapes live in **@argus/shared** and are imported by backend, workers
and frontend. Never hand-duplicate a type — the Go agent's structs serialize to the
same JSON (camelCase keys, ISO-8601 UTC timestamps).

**Invariants**

- **RBAC/ABAC** — users → groups → roles → permissions. Access ONLY via groups; no
  direct user→role/permission. The `superadmin` role + bootstrap superadmin user are
  immutable.
- **Secrets** are never serialized into contracts; stored as AES-256-GCM encrypted
  envelopes.
- **Overall rollup** — any critical unit DOWN/HANG → DOWN; else any non-critical
  DOWN/HANG → DEGRADED; all UP → UP; else UNKNOWN.
- **Health statuses** — `UP | DEGRADED | HANG | DOWN | UNKNOWN`.
- Every status change + client connect/disconnect writes a durable event row; the
  live view is derived.

**WebSocket protocol**

- Operators/wallboards: `WS /ws`, authenticated (JWT or device token); server sends
  `snapshot` then `patch`; ping/pong heartbeat.
- Agents: authenticated control channel (connection key); messages: register,
  heartbeat, config (push/ack), command (restart/update), telemetry-ack.
