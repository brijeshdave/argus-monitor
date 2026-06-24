<!-- Argus Agent — Author: Brijesh Dave (https://github.com/brijeshdave) -->
# Argus Agent — Changelog

All notable changes to the **agent** are recorded here. The version is single-sourced
in [`VERSION`](VERSION) and stamped identically into **every** platform build
(windows/linux/darwin, amd64/arm64) via `scripts/build.sh` → `main.Version`.
Format follows [Keep a Changelog](https://keepachangelog.com/); the agent uses
[SemVer](https://semver.org/).

## [1.0.0] — 2026-06-24
First public release.

### Added
- Config-less operation — only a **connection key** is needed; monitor config is
  pulled from the backend (`GET /api/agent/config`) and hot-reloaded.
- **WSS control channel** (register / heartbeat / ack) with capped-backoff reconnect;
  applies `restart` / `update` / `config` commands pushed from the UI.
- **HTTPS telemetry** push with disk-backed **store-and-forward** (no data loss
  across outages).
- **Collectors** (cross-platform via gopsutil): process/service, TCP ping, host
  metrics, SQL Server, SMB/NAS storage, SNMP.
- **Service lifecycle** (`service install|uninstall|start|stop|restart`) via systemd /
  Windows SCM / launchd; **self-update** apply; gated **run-as-user**.
- **Portable** foreground mode (`run -key … -server …`) — no install required.
- Multiple push destinations (server-managed) for migration / parallel environments.
- `version` command; version reported on register and shown in the web UI.

### Notes
- Read-only by default; never touches monitored processes unless a gated remediation
  feature is enabled. Resource-light hot path.
