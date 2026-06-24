<!-- Argus · Author: Brijesh Dave (https://github.com/brijeshdave) -->
# ADR-0001 — Backend/worker runtime: Node 22 LTS

**Status:** accepted · **Date:** 2026-06-14

## Context
The platform needs a stable, well-supported runtime for the Fastify backend and
BullMQ workers. Bun was considered for raw speed.

## Decision
Use **Node 22 LTS**. Pin via `.nvmrc`, `engines`, and `node:22-bookworm-slim`
base images.

## Rationale
- Best-in-class stability and compatibility with Fastify, `pg`, `better-sqlite3`,
  `ioredis`, `bullmq` and native modules — zero edge cases for enterprise use.
- LTS support window matches a "install and forget" product.
- Bun's performance edge does not outweigh occasional plugin/native-module risk
  for a system of record.

## Consequences
- Slightly lower raw throughput than Bun; mitigated by horizontal scaling.
- Single, predictable toolchain in CI and Docker.
