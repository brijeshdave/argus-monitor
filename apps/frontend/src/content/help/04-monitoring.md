---
title: Dashboard & monitoring
order: 40
---

## The dashboard

The dashboard shows one card per monitored host with its overall rollup status and
key stats. Colour tells you health at a glance, and cards update live over a
WebSocket — no manual refresh needed.

**Status meanings**

- **UP** — everything healthy.
- **DEGRADED** — a non-critical unit is down or hanging.
- **DOWN** — a critical unit is down or hanging.
- **HANG** — a unit is unresponsive.
- **UNKNOWN** — no recent data (the agent may be offline).

The **overall rollup** for a host is computed as: any critical unit DOWN/HANG →
DOWN; otherwise any non-critical unit DOWN/HANG → DEGRADED; all UP → UP; otherwise
UNKNOWN. Cards adapt to the host type — a database host shows connection stats, a
NAS host shows storage, an application host shows connected clients.

## Agents & installing them

An **agent** is the small program that runs on a monitored host. It's read-only by
default — it observes and reports, and never restarts, kills or modifies the things
it watches unless a separately-gated remediation feature is explicitly built and
enabled. It honours strict CPU/memory rails and is safe to run on production hosts.

**Adding a host**

1. Go to **Agents → Connection keys** and mint a new connection key.
2. Go to **Agents → Agent installers** and download the agent build for the host's
   OS (Windows, Linux or macOS).
3. Run the installer/binary on the host and provide the connection key when
   prompted.
4. The agent connects outbound over secure WebSocket, registers, and appears under
   **Agents** for approval.
5. Approve the agent, then configure what it should monitor on its detail page.

> Agents connect **outbound only** (WSS for control, HTTPS for telemetry), so no
> inbound firewall holes are required on the monitored host.

**Store-and-forward** — if the network drops, the agent buffers telemetry to disk
and forwards it when connectivity returns, so no data is lost. A supervisor keeps
the agent running and can self-update it.

**Debug mode** — for troubleshooting you can enable debug mode on a specific agent
from the server. It produces detailed logs you can watch live (continuously, or
refreshed every 5/10/20/30 seconds). Switch back to normal mode when finished.

**Multiple destinations** — an agent can be configured (server-side) to push to an
additional backend — useful during migrations or for a parallel development
environment. The primary backend remains the one that controls the agent.

## Configuring what is monitored

Each host has one or more **monitors** (units). Add, edit, reorder and delete them
on the host's detail page. Mark a unit **critical** if its failure should make the
whole host DOWN; leave it non-critical if it should only degrade the host.

**Monitor types**

- **Service / program** — a Windows service, systemd unit or process. Reports
  up/down and, for app servers, connected clients.
- **Host metrics** — CPU, memory, disk and network of the host itself.
- **Database** — connectivity and key metrics for the database engines you point it
  at.
- **Network storage (NAS/SMB)** — share availability plus folder-size scans.
- **SNMP** — device metrics via SNMP profiles and MIBs.
- **Synthetic checks** — HTTP, TCP, DNS and ping checks run server-side from the
  Argus host, so no agent is needed on the target.

**Check timing** — per-monitor you can tune the check interval, retries and retry
interval; ping checks also take a packet count. Sensible defaults are applied to new
monitors.

## Network storage (NAS) scans

For NAS/SMB monitors, Argus can walk the share and record **folder sizes** over
time, so you can see which folders are growing and act before a volume fills up.

- Trigger a scan on demand, or let scheduled scans record history automatically.
- A running scan can be **paused**, **resumed** or **cancelled** (large shares take
  time).
- Folder-size history is charted per folder and is subject to your retention
  settings.
- Scan activity (start, progress, completion, cancellation, failures) is written to
  the logs.

> Very large shares are scanned with a depth-limited walk so a single scan completes
> in reasonable time rather than timing out.
