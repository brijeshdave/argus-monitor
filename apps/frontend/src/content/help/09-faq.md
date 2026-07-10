---
title: FAQ
order: 90
faq: true
---

## How do I install Argus?

Three supported paths: **Docker** (`./argus up && ./argus migrate && ./argus seed`),
**from source** (`pnpm install && pnpm -r build`, then migrate/seed against your own
PostgreSQL), or **Kubernetes** (`kubectl apply -k deploy/k8s/base`). See the
Installation section for full steps.

## Do I need Docker?

No. Docker is the easiest path, but you can run the Node services directly from
source against your own PostgreSQL, or deploy on Kubernetes with the provided
Kustomize manifests.

## What are the system requirements?

PostgreSQL 14+ (17 recommended), and for the from-source path Node 22 LTS + pnpm 9.
Redis 7+ is optional (needed only for multi-node/queued workers). Monitored hosts
need outbound network to the backend — no inbound ports.

## How do I create the first admin account?

Run `./argus seed` (or the from-source/k8s equivalent). It creates the bootstrap
owner/superadmin from your environment. Sign in, create real users, and change the
owner password immediately.

## Can I rename or re-brand the product?

Yes, but only at **deploy time** via the `VITE_BRAND_NAME` and `VITE_BRAND_TAGLINE`
build environment variables. Branding is deliberately not editable inside the app
and has no permission, so no operator can change it at runtime.

## Is Redis required?

No. With Redis off, Argus runs single-node with in-process background jobs. Enable
Redis to run workers on a separate host and use durable queues.

## How do I upgrade safely?

Back up first (`./argus backup`), rebuild (`./argus up` or `pnpm -r build`), then run
`./argus migrate` and `./argus seed`. The seed is idempotent and self-heals the
permission catalogue.

## Does the agent change anything on my server?

No. The agent is **read-only by default** — it observes and reports and never
restarts, kills or modifies the things it monitors, unless a separately-gated
remediation feature is explicitly built and enabled.

## Do I need to open inbound firewall ports for the agent?

No. Agents connect **outbound only** — secure WebSocket for control and HTTPS for
telemetry. No inbound holes are required on the monitored host.

## What happens to data if an agent loses connectivity?

The agent buffers telemetry to disk (store-and-forward) and sends it once the
connection is restored, so no data is lost.

## Why does a host show DOWN when only one service is down?

That service is marked **critical**. Any critical unit being DOWN or HANG makes the
whole host DOWN. Mark it non-critical if its failure should only degrade the host.

## How do I monitor a website or API endpoint?

Add a **synthetic monitor** (HTTP/TCP/DNS/ping). These run server-side from the
Argus host, so you don't need an agent on the target.

## I forgot the admin password — how do I get back in?

From the host shell run `./argus reset-password` (no arguments resets the owner and
prints a new password). It works offline, bypassing the API, so it recovers the account
even when it's the only user. It also clears any login lockout and invalidates existing
sessions. Add `--reset-2fa` if you also lost your two-factor device. Sign in, then
change the password under **Profile**.

## Will changing my password log me out?

It keeps your **current** session signed in but ends all your **other** sessions, so
a leaked old session is revoked.

## What can I safely put on the public status page?

Only the coarse status items you explicitly select in Admin → Public status. The
public page is designed to never leak internal details.

## What licence is Argus under?

Argus is dual-licensed: **AGPL-3.0** for open-source/self-hosted use, with a separate
**commercial licence** available for closed-source or managed-service use. See the
project's COMMERCIAL.md.

## How do I edit this documentation?

The docs are Markdown files in the repository (`apps/frontend/src/content/help` for
this help centre, `apps/backend/src/content/developer` for the developer docs). Edit
or add a `.md` file and open a pull request — see the developer docs for details.
