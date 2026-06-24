# Argus — Monitoring Platform · Author: Brijesh Dave <https://github.com/brijeshdave>
# Backend image. Build context = repository root (pnpm workspace).
# Pinned to Node 22 LTS for stability (see docs/adr/0001).

# ── deps: install workspace dependencies (cached on lockfile) ────────────────
FROM node:22-bookworm-slim AS deps
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/backend/package.json ./apps/backend/package.json
RUN pnpm install --frozen-lockfile || pnpm install

# ── build: compile shared packages + backend to dist ────────────────────────
FROM deps AS build
COPY . .
RUN pnpm --filter @argus/shared --filter @argus/db --filter @argus/core build \
 && pnpm --filter @argus/backend build

# ── runtime: lean, non-root ─────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN corepack enable && useradd -r -u 10001 argus
# `ping` (iputils) for the server-side reachability/latency probe; grant the
# cap_net_raw file capability so the non-root user can send ICMP echoes. If the
# host blocks file caps, the probe degrades to the TCP-connect fallback.
# iputils-ping → server-side reachability/latency probe (cap_net_raw for non-root).
# smbclient → server-side NAS storage probe (capacity + folder sizes via SMB, no agent).
RUN apt-get update \
 && apt-get install -y --no-install-recommends iputils-ping libcap2-bin smbclient \
 && setcap cap_net_raw+ep /usr/bin/ping || true \
 && rm -rf /var/lib/apt/lists/*
# Go toolchain so the "build agent from UI" feature works in-container. Writable
# caches under /tmp for the non-root user; GOTOOLCHAIN may fetch the pinned version.
COPY --from=golang:1.25-bookworm /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}" GOPATH=/tmp/go GOCACHE=/tmp/gocache GOMODCACHE=/tmp/gomod
WORKDIR /repo
COPY --from=build /repo .
USER argus
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/backend/dist/server.js"]
