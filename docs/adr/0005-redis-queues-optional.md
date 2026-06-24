<!-- Argus · Author: Brijesh Dave (https://github.com/brijeshdave) -->
# ADR-0005 — Redis + BullMQ: present from the start, but optional

**Status:** accepted · **Date:** 2026-06-14

## Context
The platform needs background jobs (agent builds, reports, backups, retention,
storage scans) and may run as a single node or as a scaled cluster.

## Decision
Integrate **Redis** and **BullMQ** from the start, gated by `REDIS_ENABLED`:
- **Enabled** → BullMQ queues; **workers can run on a separate machine/host**;
  Redis also backs cross-instance WebSocket fan-out, rate-limiting and caching.
- **Disabled** → an **in-process queue** runs jobs inside the backend and an
  in-memory pub/sub serves WS fan-out. Single-node, zero extra infrastructure.

## Rationale
- "Optional Redis" and "remote workers" are the same switch — remote/scaled
  workers inherently need a shared bus.
- Keeps the easiest-setup promise (single node, no Redis) while enabling scale.

## Consequences
- Job code is written against a thin queue interface with two implementations.
- Multi-instance backend requires Redis (documented).

## Should we use queues / Redis?
Yes — but optional, exactly as above. Recommended **on** for any multi-host or
production deployment; **off** is fine for small single-node installs.
