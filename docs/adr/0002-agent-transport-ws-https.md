<!-- Argus · Author: Brijesh Dave (https://github.com/brijeshdave) -->
# ADR-0002 — Agent transport: outbound WebSocket control + HTTPS ingest

**Status:** accepted · **Date:** 2026-06-14

## Context
The agent must run on locked-down hosts (no inbound ports), let the backend push
commands (config, restart, self-update), survive network outages without losing
data, and traverse environments **with or without a reverse proxy**. gRPC bidi
streaming and plain HTTPS-poll were considered.

## Decision
Hybrid: a single **outbound WebSocket (WSS)** control channel (commands + config
+ status) plus **HTTPS POST** for bulk telemetry ingest. Connection-key auth,
optional mTLS.

## Rationale
- Outbound-only preserves the "no inbound ports" safety rule.
- WebSocket is the most proxy/firewall-friendly bidirectional option and lets the
  backend push commands with low latency.
- HTTPS ingest is simple, cacheable-free, and easy to batch + retry.
- gRPC's strict typing didn't justify its HTTP/2-through-proxy friction for the
  "easiest setup" goal.

## Consequences
- Two channels to manage, but each is simple and independently testable.
- Disk-backed store-and-forward spool guarantees no telemetry loss across outages.
