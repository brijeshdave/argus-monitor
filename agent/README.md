<!-- Argus — Monitoring Platform · Author: Brijesh Dave (https://github.com/brijeshdave) -->
# Argus Agent (Go)

A single static binary that runs on each monitored host. **Config-less** — the
only input is a *connection key* generated in the Argus web UI. Everything else
(what to monitor, intervals, toggles) is pulled from the backend over the
WebSocket control channel and hot-reloaded.

## Design goals
- **Safe on production hosts** — read-only by default; never touches monitored
  processes unless a separately-gated remediation feature is enabled.
- **Never lose data/connection** — disk-backed store-and-forward spool; auto
  reconnect with capped backoff; cached last-known config for offline operation.
- **Self-healing** — a supervisor restarts the agent on crash and applies signed
  self-updates atomically (rollback on failure). Hard CPU/memory rails so it can
  never harm the host.
- **Install-and-forget** — one-time elevated install as a least-privilege service
  account; thereafter updates/config/restart are driven remotely from the UI.

## Modes
```
argus-agent run -key <KEY> -server <URL>   # foreground, no install (development)
argus-agent service install|start|stop|restart|uninstall   # production
argus-agent version
```

## Build & versioning
```
./scripts/build.sh all        # windows/linux/darwin (amd64+arm64) → dist/
```
The version is **single-sourced** in [`VERSION`](VERSION) and stamped identically into
**every** platform build (`main.Version`); `argus-agent version` and the web UI show it.
Changes are tracked in [`CHANGELOG.md`](CHANGELOG.md). You can also build/download each
platform straight from the web UI (Agents → Agent installers).

## Portable mode (no install)
The binary is a single, static, dependency-free executable — copy it anywhere and run:
```
argus-agent run -key <KEY> -server https://argus.example.com
```
It needs no install, no admin, and no local config. Stop it with Ctrl-C. Ideal for
quick checks, locked-down hosts, or USB/portable use. (Foreground mode keeps a bounded
local log buffer and streams a live tail to the UI; only important events are persisted.)

## Install as a service (install-and-forget)
```
argus-agent service install -key <KEY> -server <URL>   # one-time (elevation needed)
argus-agent service start
...
argus-agent service uninstall                          # clean removal
```
Uses systemd (Linux), **Windows SCM** (Windows / Windows Server), or launchd (macOS).
Uninstall fully removes the service unit.

## Windows Server
Fully supported (Windows Server 2016+). Install from an elevated prompt; the agent runs
under the Windows Service Control Manager and survives reboots. Process/service collectors
use portable APIs (gopsutil). For "run a program/service as a specific user", that gated
feature requires the service account to hold the right privileges.

## Self-update
`update` commands from the UI download a new signed* binary and replace the running one
atomically, then the service relaunches. (*signature/checksum verification is a tracked
follow-up; today it pins to artifacts served by the trusted backend.)
