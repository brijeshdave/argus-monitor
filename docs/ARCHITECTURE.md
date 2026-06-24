<!-- Argus — Monitoring Platform · Author: Brijesh Dave (https://github.com/brijeshdave) -->
# Argus — Architecture

Argus is a **versatile, agent-based monitoring platform**. A lightweight Go agent
runs on each monitored host, collects health/metrics/inventory and pushes it to a
central backend. The backend persists a full event history, serves a live
SCADA/HMI dashboard, and drives wallboards and a public status page. **What is
watched is configured, never hardcoded** — Argus monitors services, programs,
hosts, databases and network storage of any kind.

## 1. Components

| Component | Stack | Role |
|-----------|-------|------|
| **Agent** | Go 1.22+ static binary | One per host. Config-less (connection key only). Collects + pushes; receives config/commands over a control channel. Read-only by default, self-healing. |
| **Backend** | Node 22 LTS, Fastify, pino, zod | REST API, WebSocket hub (operators + agent control plane), ingest, domain orchestration. |
| **Workers** | Node 22, BullMQ | Agent builds, report rendering, DB backup/restore, retention pruning, storage scans. In-process (no Redis) or separate host (with Redis). |
| **Frontend** | React 18, Vite, Tailwind, Recharts, dnd-kit | Dashboard, admin, wallboard builder/kiosk, public status. |
| **Master DB** | PostgreSQL (SQLite dev) | Identity, RBAC, configs, encrypted secrets. |
| **Telemetry DB** | PostgreSQL / TimescaleDB | Metrics, events, logs, audit. |
| **Redis** (optional) | Redis 7 | Queue bus, cross-instance WS fan-out, rate-limit, cache. |

## 2. Topology

```
 Monitored hosts                        Argus server(s)                     Operators / Wallboards
 ┌───────────────────┐                  ┌──────────────────────────────┐
 │ Argus Agent (Go)  │  WSS control ───▶│ Backend (Fastify + ws)       │◀── WS/REST ── Browser
 │ • collectors      │  HTTPS ingest ──▶│  • auth (RBAC/ABAC, OIDC)    │◀── WS ─────── Wallboard kiosk
 │ • store-and-fwd   │◀── commands ─────│  • ingest + diff → events    │
 │ • supervisor      │   (cfg/restart/  │  • WS hub (live state)       │
 └───────────────────┘    update)       │  • domain (@argus/core)      │
                                        └───────┬──────────────┬───────┘
                                  enqueue jobs  │              │ read/write
                                        ┌───────▼──────┐  ┌────▼─────────────────┐
                                        │ Workers      │  │ master DB │ telemetry │
                                        │ (BullMQ)     │  │ (Postgres)│ (PG/TSDB) │
                                        └──────┬───────┘  └───────────┴───────────┘
                                               │ optional
                                        ┌──────▼──────┐
                                        │ Redis       │
                                        └─────────────┘
```

## 3. Agent ↔ backend protocol (ADR-0002)

- **Control plane:** the agent opens a single **outbound WebSocket (WSS)** to the
  backend — no inbound ports on monitored hosts. Used for registration,
  heartbeat, config push, restart, and self-update commands (backend → agent).
- **Telemetry:** bulk snapshots are pushed over **HTTPS POST** (efficient, simple,
  proxy-friendly). When offline, snapshots queue in a disk-backed **store-and-forward**
  spool and replay on reconnect — telemetry is never lost.
- **Auth:** per-agent **connection key** (minted in UI, stored encrypted). Optional
  **mTLS**. First connect → `pending` until a superadmin approves the agent.
- **Self-healing:** a supervisor restarts the agent on crash, applies signed
  self-updates atomically (rollback on failure), and enforces CPU/memory rails so
  the agent can never harm the host.

## 4. Data architecture (ADR-0003)

Two **logically separate databases** behind a DB-agnostic layer (`@argus/db`,
Drizzle ORM):
- **master** — low-volume system of record: users, groups, roles, permissions,
  agents, monitors, configs, **encrypted secrets**, settings.
- **telemetry** — high-volume, time-oriented: metrics, status/client events,
  categorized logs, audit, uptime buckets, notifications.

Separation lets telemetry scale or swap (Postgres → TimescaleDB) without touching
the source of truth. SQLite is the zero-dependency dev/quickstart driver.

## 5. Security (see docs/security.md)

- **Secrets at rest:** AES-256-GCM envelopes keyed by a master key (env/KMS); every
  credential (agent keys, DB creds, SMB/SNMP/API) encrypted, never logged, redacted
  in audit. Nothing sensitive leaves a monitored host that shouldn't.
- **AuthN:** local accounts (scrypt) + generic **OIDC**; JWT access + rotating refresh.
- **AuthZ:** **RBAC + ABAC** — users → groups → roles → permissions (no direct
  user grants); attributes refine scope. Immutable seeded superadmin.
- **Transport:** TLS everywhere; optional agent mTLS; rate limiting; secure headers.
- **Proxy-aware:** works with or without a reverse proxy; `TRUST_PROXY` off by default.

## 6. Observability

OpenTelemetry traces + metrics (OTLP export optional) and structured pino JSON
logs across backend and workers. Everything is also **audited** to the telemetry DB.

## 7. Scaling

Stateless backend + workers scale horizontally behind Redis (WS fan-out + queue).
Telemetry DB upgrades to TimescaleDB. Bind-mounted data in Docker; Kubernetes via
Kustomize. Single-node mode (no Redis) runs everything in one backend.

## 8. Monorepo

```
apps/      backend · workers · frontend
packages/  shared (contracts/zod) · db (drizzle) · core (domain logic)
agent/     Go agent (separate toolchain)
deploy/    docker-compose (+dev) · k8s · postgres init
docs/      this folder (+ adr/)
```

See [adr/](adr/) for the decisions behind these choices.
