<!-- Argus — Monitoring Platform · Author: Brijesh Dave (https://github.com/brijeshdave) -->
# Argus — Screenshots

A visual tour of the platform. Images live in [`screenshots/`](screenshots/).

> Redact real hostnames, IPs, names and tokens before capturing.

## Dashboard
Live, per-host rollup status pushed over WebSocket.

<p align="center"><img src="screenshots/dashboard.png" width="900" alt="Dashboard"></p>

## Agents
Connection keys, installers, approval and per-agent control (restart, debug mode).

<p align="center"><img src="screenshots/agents.png" width="900" alt="Agents"></p>

## Host metrics
CPU, memory, disk and network for the monitored host.

<p align="center"><img src="screenshots/agent_metrics.png" width="900" alt="Host metrics"></p>

## Monitors
Per-host monitors: services, host metrics, databases, NAS/SMB, SNMP, synthetic checks.

<p align="center"><img src="screenshots/agent_monitors.png" width="900" alt="Monitors"></p>

## Databases (SQL Server)
Health and performance — key DMVs, top queries, waits and history.

<p align="center"><img src="screenshots/agent_db.png" width="900" alt="Database health"></p>
<p align="center"><img src="screenshots/agent_db_top_queries.png" width="900" alt="Top queries"></p>
<p align="center"><img src="screenshots/agent_db_waits.png" width="900" alt="Wait stats"></p>
<p align="center"><img src="screenshots/agent_db_hostory.png" width="900" alt="Database history"></p>

## Network storage (NAS / SMB)
Share capacity plus folder-size scans and growth history.

<p align="center"><img src="screenshots/agent_nas_1.png" width="900" alt="NAS overview"></p>
<p align="center"><img src="screenshots/agent_nas_storage.png" width="900" alt="NAS storage"></p>
<p align="center"><img src="screenshots/agent_nas_storage_folder_tree.png" width="900" alt="NAS folder tree"></p>

## SNMP devices
Device health collected server-side via SNMP profiles and MIBs.

<p align="center"><img src="screenshots/agent_nas_snmp.png" width="900" alt="SNMP device"></p>
<p align="center"><img src="screenshots/agent_nas_snmp_metrics.png" width="900" alt="SNMP metrics"></p>
<p align="center"><img src="screenshots/agent_nas_snmp_storage_stats.png" width="900" alt="SNMP storage stats"></p>

## Live logs
Near-live agent logs and deployment/agent activity.

<p align="center"><img src="screenshots/agent_live_logs.png" width="900" alt="Live logs"></p>
<p align="center"><img src="screenshots/agent_deploy_logs.png" width="900" alt="Deployment logs"></p>

## Wallboards
Drag-and-drop NOC boards for control-room TVs.

<p align="center"><img src="screenshots/wallboard_1.png" width="900" alt="Wallboard 1"></p>
<p align="center"><img src="screenshots/wallboard_2.png" width="900" alt="Wallboard 2"></p>

## Display devices
Pair unattended screens and target boards to device groups.

<p align="center"><img src="screenshots/agent_devices_display.png" width="900" alt="Display devices"></p>
<p align="center"><img src="screenshots/wallboard_display_settings.png" width="900" alt="Wallboard display settings"></p>

## Ticker
Audience-targeted scrolling announcements with severity + scheduling.

<p align="center"><img src="screenshots/ticker.png" width="900" alt="Ticker"></p>

## Public status page
Secure-by-construction public status at `/status`, configured from the admin UI.

<p align="center"><img src="screenshots/public_status.png" width="900" alt="Public status page"></p>
<p align="center"><img src="screenshots/public_status_settings_1.png" width="900" alt="Public status settings"></p>

## Uptime & SLA
Availability history and SLA percentages from the durable event log.

<p align="center"><img src="screenshots/uptime_1.png" width="900" alt="Uptime / SLA"></p>

## Reports
Exportable operational reports for a chosen period.

<p align="center"><img src="screenshots/reports_1.png" width="900" alt="Reports 1"></p>
<p align="center"><img src="screenshots/reports_2.png" width="900" alt="Reports 2"></p>
