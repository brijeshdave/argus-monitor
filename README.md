<!-- Argus — Monitoring Platform · Author: Brijesh Dave (https://github.com/brijeshdave) -->
<div align="center">

# Argus

**A versatile, agent-based monitoring platform.**

Monitor services, hosts, databases, network storage, SNMP devices and synthetic
endpoints — from a single live operations console, NOC wallboards and a public
status page. What is watched is configured, never hardcoded.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Commercial license available](https://img.shields.io/badge/Commercial-license%20available-green.svg)](COMMERCIAL.md)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)
![Go agent](https://img.shields.io/badge/Agent-Go-00ADD8.svg)
![Node 22 LTS](https://img.shields.io/badge/Node-22%20LTS-339933.svg)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-336791.svg)
![Docker · Kubernetes](https://img.shields.io/badge/Deploy-Docker%20%C2%B7%20Kubernetes-2496ed.svg)

</div>

---

## Overview

Argus is an **agent-based monitoring platform**. A lightweight, read-only agent
runs on each monitored host, collects health, metrics and inventory, and pushes it
to a central backend over an outbound secure channel (no inbound ports on the
host). The backend keeps a **durable event history** — the live view is derived,
but the event log is the system of record — and serves a real-time dashboard,
drag-and-drop wallboards for control rooms, and an optional public status page.

> **Note:** This project was built with an AI-assisted, "vibe-coding" workflow,
> and is backed by an automated test suite (unit + integration) with the changes
> exercised against a running stack before release.

## Features

- **Config-less, safe agent** — authenticated with a single UI-minted connection
  key; remote config, restart and self-update; disk-backed store-and-forward so no
  data is lost; read-only by default and safe on production hosts.
- **Monitor anything** — services/programs, host metrics, databases, network
  storage (NAS/SMB) with folder-size scans, SNMP devices, and server-side synthetic
  checks (HTTP/TCP/DNS/ping). Per-monitor intervals, retries and criticality.
- **Live operations console** — real-time dashboard with per-host rollup status,
  pushed over WebSocket; categorised logs; uptime/SLA history; exportable reports;
  acknowledgeable notifications.
- **NOC wallboards & displays** — build boards with drag-and-drop tiles, pair
  unattended TVs with a 6-digit code, rotate layouts, and target content by device
  group. A configurable, audience-targeted scrolling ticker for announcements.
- **Public status page** — secure-by-construction; exposes only the coarse,
  hand-picked components you choose.
- **Enterprise access control** — group-based **RBAC** (users → groups → roles →
  permissions) refined by **ABAC** attributes, generic **OIDC** SSO, TOTP 2FA,
  session management, and a full audit trail with field-level before→after diffs.
- **Operations** — scheduled, retention-aware backups (config / data / both) with
  restore; configurable data retention; per-agent debug mode with live logs.
- **Built-in documentation** — a public help centre at `/docs` and gated developer
  docs at `/developers`.

## Screenshots

<p align="center">
  <img src="docs/screenshots/dashboard.png" width="1200" alt="Dashboard">
  <br><em>Live operations dashboard</em>
</p>

<p float="left">
  <img src="docs/screenshots/wallboard_1.png" width="49%" alt="Wallboard">
  <img src="docs/screenshots/agents.png" width="49%" alt="Agents">
</p>

📸 **Full gallery →** [`docs/SCREENSHOTS.md`](docs/SCREENSHOTS.md)

## Architecture

| Component  | Stack                                   | Role |
| ---------- | --------------------------------------- | ---- |
| Agent      | Go (single binary)                      | Collects + pushes telemetry from each host |
| Backend    | Node 22 LTS · Fastify · zod · pino      | REST API + WebSocket hub + ingest → events |
| Workers    | Node · BullMQ (optional)                | Builds, reports, backups, retention, scans |
| Frontend   | React 18 · Vite · Tailwind · Recharts   | Dashboard, admin, wallboards, public pages |
| Data       | PostgreSQL (`master` + `telemetry`)     | Identity/config vs. metrics/events/audit |
| Queue      | Redis + BullMQ (optional)               | Multi-node / durable background jobs |

Domain logic lives in a framework-free `core` package; shared contracts (and zod
schemas) live in `shared` and are the single source of truth across backend,
workers, frontend and the Go agent. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
and the [Architecture Decision Records](docs/adr/).

## Quick start (Docker)

```bash
git clone <your-repo-url> argus && cd argus
cp .env.example .env          # set DB creds, JWT secret, encryption key
./argus up                    # build + start backend, workers, frontend, db[, redis]
./argus migrate && ./argus seed
# open http://localhost:8081  and sign in as the seeded owner
```

Run `./argus help` for all management commands. Full installation instructions —
**Docker, from source, and Kubernetes** — are in the in-app help centre at `/docs`.

## Installation options

- **Docker** (recommended) — the bundled `./argus` CLI wraps Docker Compose.
- **From source** — `pnpm install && pnpm -r build`, then migrate/seed against your
  own PostgreSQL; run the Node services behind a process supervisor.
- **Kubernetes** — Kustomize manifests under [`deploy/k8s/`](deploy/k8s/).

## Configuration

All configuration comes from the environment (see [`.env.example`](.env.example)).
Notable settings: PostgreSQL connection, the JWT secret and AES-256-GCM encryption
key, `REDIS_ENABLED`, `TRUST_PROXY` (for correct client IPs behind a proxy), and
**white-label branding** via the build-time `VITE_BRAND_NAME` / `VITE_BRAND_TAGLINE`
(there is no in-app branding setting by design).

## Security

Per-agent connection keys (optional mTLS); JWT access + rotating refresh tokens;
generic OIDC; RBAC/ABAC enforced on every route; AES-256-GCM secrets at rest; rate
limiting and secure headers; full audit of every mutation with secret redaction;
proxy-aware. Public surfaces expose only coarse, whitelisted data.

## Documentation

- **In-app:** `/docs` (public help centre) · `/developers` (developer docs, gated
  by the `developer:read` permission).
- **In-repo:** [Architecture](docs/ARCHITECTURE.md) ·
  [Decisions (ADRs)](docs/adr/) ·
  [Agent guide](agent/README.md) · [Docs index](docs/README.md).

## License

Argus is **dual-licensed**:

- **[GNU AGPL-3.0](LICENSE)** for open-source and self-hosted use. If you run a
  modified version as a network service, you must publish your changes under the
  same license.
- A **[commercial license](COMMERCIAL.md)** for closed-source embedding or offering
  Argus as a managed service without AGPL obligations.

The copyright is held in full by the author, who can grant commercial licenses.

## Author

**Brijesh Dave** — <https://github.com/brijeshdave>
