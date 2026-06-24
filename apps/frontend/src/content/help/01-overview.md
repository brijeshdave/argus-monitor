---
title: What is Argus?
order: 10
---

Argus is a versatile, **agent-based monitoring platform**. A lightweight agent runs
on each monitored host, collects health, metrics and inventory, and pushes it to a
central backend. The backend keeps a full, durable event history and serves a live
operations dashboard, NOC wallboards for control rooms, and an optional public
status page.

**What is watched is configured, never hardcoded.** Argus can monitor services and
programs, host metrics, databases, network storage (NAS/SMB), SNMP devices and
synthetic checks (HTTP/TCP/DNS/ping) — any combination, on any host.

## Key principles

- **Safe by default** — the agent is read-only; it observes and reports and never
  restarts or modifies what it watches.
- **Event log is the system of record** — the live view is derived; every status
  change and client connect/disconnect is a durable row.
- **Access only via groups** — users get permissions through groups → roles →
  permissions (RBAC), refined by optional ABAC attributes.
- **Secure by construction** — secrets are encrypted at rest; public surfaces
  expose only coarse, hand-picked data.

> **Note:** This project was built with an AI-assisted, "vibe-coding" workflow, and
> is backed by an automated test suite (unit + integration) with changes exercised
> against a running stack before release.
