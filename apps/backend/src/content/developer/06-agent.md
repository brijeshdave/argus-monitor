---
title: The agent (Go)
order: 60
---

The agent is a single Go binary, config-less by design: it authenticates with a
UI-minted connection key and pulls its monitor config + commands from the backend.
It is read-only on the host and honours supervisor resource rails.

- **Control channel** — outbound WebSocket (WSS): register, heartbeat, config
  push/ack, commands (restart/update), telemetry-ack.
- **Telemetry** — pushed over HTTPS, with disk-backed store-and-forward so nothing
  is lost across outages.
- **Hot path discipline** — return errors (never panic in the collect/push loop),
  context-cancel everything, keep allocations low.
- **Cross-compilation** — `./argus agent-build [windows|linux|darwin|all]` produces
  installers/binaries; downloads are served from Agents → Agent installers.
- **Multi-host** — an agent can be configured server-side to also push to a second
  backend (e.g. a dev environment); the primary backend keeps control.

> Go tests stay colocated (`*_test.go`). Run `go build ./...` and `go vet ./...`
> from `agent/` — keep them clean.
