---
title: Installation
order: 20
---

Argus ships as a small set of services: a **backend** (API + WebSocket hub),
**workers** (background jobs), a **frontend** (the web UI), one or two
**PostgreSQL** databases, and optionally **Redis**. You can run it with Docker
(recommended), from source, or on Kubernetes.

## Requirements

- **PostgreSQL 14+** (17 recommended). Argus uses a `master` and a `telemetry`
  database; the embedded PGlite engine is for development/testing only.
- **Node.js 22 LTS** and **pnpm 9+** (only needed for the from-source path).
- **Docker** + the Compose plugin (for the container path).
- **Redis 7+** — optional; enables a separate worker host and queues. Off → single
  node in-process mode.
- Outbound network from each monitored host to the backend (WSS + HTTPS). No
  inbound ports are required on monitored hosts.

## Option A — Docker (recommended)

The repository ships a management CLI (`./argus`) that wraps Docker Compose with
sensible defaults and bind mounts.

```bash
# 1. Clone and enter the project
git clone <your-repo-url> argus && cd argus

# 2. Create your environment file from the example and edit secrets
cp .env.example .env        # set DB creds, JWT secret, encryption key, etc.

# 3. Build images and start the stack (backend, workers, frontend, db[, redis])
./argus up

# 4. Apply database migrations, then seed roles/permissions + the owner
./argus migrate
./argus seed

# 5. Check status / tail logs
./argus ps
./argus logs
```

> **Note:** `./argus migrate` and `./argus seed` run inside the **built image**.
> Always run `./argus up` (which rebuilds) BEFORE migrate/seed after pulling
> changes, or the old code runs and the change silently no-ops.

The UI is served by the frontend container (by default on port **8081**) and the
API on **8080**. Put a TLS-terminating reverse proxy (the bundled Caddy config, or
your own) in front for production.

## Option B — Without Docker (from source)

Run the Node services directly against your own PostgreSQL. Useful for bare-metal
or VM deployments.

```bash
# Prerequisites: Node 22, pnpm 9, a running PostgreSQL with two databases
#   createdb argus_master ; createdb argus_telemetry

pnpm install              # install workspace dependencies
cp .env.example .env      # point DB_* at your PostgreSQL, set secrets

pnpm -r build             # build shared, db, core, backend, workers, frontend
pnpm --filter @argus/db migrate    # apply migrations
pnpm --filter @argus/db seed       # seed RBAC + owner

# Start the services (use a process manager / systemd in production)
node apps/backend/dist/index.js    # API + WS hub
node apps/workers/dist/index.js    # background workers (optional without Redis)

# Serve the built frontend (apps/frontend/dist) with any static web server
#   e.g. nginx, Caddy, or `pnpm --filter @argus/frontend preview` for a quick test
```

> Run each service behind a process supervisor (systemd, pm2) so it restarts on
> failure, and front the frontend + API with a reverse proxy that terminates TLS.

## Option C — Kubernetes

Kustomize manifests live under `deploy/k8s/`. They define a namespace, ConfigMap,
Secret, the backend/workers/frontend Deployments and Services, and an Ingress.

```bash
# 1. Provide secrets (DB creds, JWT secret, encryption key)
cp deploy/k8s/base/secret.example.yaml deploy/k8s/base/secret.yaml
#   edit secret.yaml — do NOT commit it

# 2. Review the ConfigMap (DB hosts, feature flags, branding) and Ingress host
$EDITOR deploy/k8s/base/configmap.yaml deploy/k8s/base/ingress.yaml

# 3. Apply
kubectl apply -k deploy/k8s/base

# 4. Run migrations + seed once (as a Job, or exec into the backend pod)
kubectl -n argus exec deploy/argus-backend -- node dist/migrate.js
kubectl -n argus exec deploy/argus-backend -- node dist/seed.js
```

Provide PostgreSQL (and Redis, if enabled) either as in-cluster StatefulSets or as
managed services referenced from the ConfigMap/Secret. Scale the backend and
workers horizontally; enable Redis when you run more than one replica.

## First sign-in

Seeding creates the bootstrap **owner** (superadmin) account. Sign in with the
credentials from your environment, then immediately create real user accounts and
change the owner password. The owner account and the `superadmin` role are
protected and cannot be deleted or demoted.

## Branding (white-label)

The product name and tagline are set at **deploy time** via the build environment
variables `VITE_BRAND_NAME` and `VITE_BRAND_TAGLINE` (defaults: "Argus" /
"Monitoring"). Branding is intentionally **not** changeable from inside the app and
has no associated permission, so it can't be altered by any operator at runtime.

## Upgrading

1. Pull the new version and **back up** first (`./argus backup`).
2. Rebuild images / rebuild from source (`./argus up` or `pnpm -r build`).
3. Run `./argus migrate` then `./argus seed` (seed is idempotent and self-heals the
   permission catalogue).
4. Verify with `./argus ps` / `./argus logs` and a quick smoke test.
