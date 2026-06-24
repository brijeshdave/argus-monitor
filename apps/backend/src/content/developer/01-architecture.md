---
title: Architecture
order: 10
---

Argus is an agent-based monitoring platform. A Go **agent** runs on each host,
authenticates with a UI-minted connection key, pulls monitor config + commands over
an outbound WebSocket (WSS) control channel, and pushes telemetry over HTTPS with
disk-backed store-and-forward.

The **backend** (Node 22 LTS, Fastify, pino, zod) serves REST + a WebSocket hub
(operators and the agent control plane), turns ingested snapshots into durable
events via a diff, broadcasts live state, and enforces RBAC/ABAC + OIDC.

**Workers** (BullMQ) handle agent builds, reports, backup/restore, retention and
scans — in-process without Redis, or on a separate host with Redis. The
**frontend** is a React 18 + Vite + Tailwind SPA (dashboard, admin, wallboards,
public status, docs).

## Stores

- **master** DB — identity, RBAC, config, secrets.
- **telemetry** DB — metrics, events, logs, audit.
- PostgreSQL only (driver `pg` in prod, `pglite` embedded for dev/test). Redis +
  BullMQ are optional.
