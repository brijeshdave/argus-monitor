/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Agent detail: header (name + status + version/platform/last-seen), permission-
 * gated lifecycle actions (approve/revoke/restart/update), this agent's monitors,
 * and a live-tailing console that stitches recent historical logs (REST) together
 * with live lines streamed over the operator WebSocket. Auto-scrolls to bottom.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AGENT_PUSH_INTERVALS, type LiveLogLine } from "@argus/shared";
import { useAgentDetail, type LogRow } from "@/hooks/useAgentDetail";
import { useAgents } from "@/hooks/useAgents";
import { useLiveState } from "@/hooks/useLiveState";
import { useAuth } from "@/auth/AuthContext";
import { useConfirm } from "@/components/ConfirmProvider";
import { api } from "@/lib/api";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { Modal } from "@/components/Modal";
import { DatabasePanel } from "@/components/DatabasePanel";
import { StoragePanel } from "@/components/StoragePanel";
import { SnmpPanel } from "@/components/SnmpPanel";
import { MonitorEditorModal } from "@/components/MonitorEditorModal";
import { PingHistory } from "@/components/PingHistory";
import { ClientsTable } from "@/components/ClientsTable";
import { HostMetricsChart } from "@/components/HostMetricsChart";
import { useClientMeta } from "@/hooks/useClientMeta";
import type { MonitorDTO } from "@argus/shared";

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Compact process uptime: "3d 4h" / "5h 12m" / "8m". */
function fmtUptime(sec: number): string {
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Tailwind text color per log level. */
function levelClass(level: string): string {
  switch (level.toLowerCase()) {
    case "error":
    case "fatal":
      return "text-rose-300";
    case "warn":
    case "warning":
      return "text-amber-300";
    default:
      return "text-slate-300";
  }
}

/** A console line — historical rows and live lines share this shape for rendering. */
interface ConsoleLine {
  level: string;
  category: string;
  message: string;
  ts: string;
}

const toConsole = (l: LogRow | LiveLogLine): ConsoleLine => ({
  level: l.level,
  category: l.category,
  message: l.message,
  ts: l.ts,
});

export function AgentDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { has } = useAuth();
  const confirm = useConfirm();
  const { loading, error, agent, monitors, commands, logs, reload } = useAgentDetail(id);
  const { approve, revoke, agents: allAgents } = useAgents();
  const { logsFor, unitFor, agents: liveAgents } = useLiveState();
  const liveHost = liveAgents.find((a) => a.id === id);
  const { byIp: clientMetaByIp, save: saveClientMeta } = useClientMeta();
  const [editClient, setEditClient] = useState<{ ip: string; hostname: string; description: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null); // the in-progress new name, or null
  const canEditClients = has("monitors:write");

  const canApprove = has("agents:approve");
  const canWrite = has("agents:write");
  const canRestart = has("agents:restart");
  const canUpdate = has("agents:update");
  const canDelete = has("agents:delete");

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("monitors");
  const canManageMonitors = has("monitors:write");
  // Monitor add/edit happens here (inside the agent) — no separate Monitors page.
  const [monitorEditor, setMonitorEditor] = useState<{ monitor: MonitorDTO | null } | null>(null);
  const [moving, setMoving] = useState<MonitorDTO | null>(null); // monitor being moved to another agent

  async function moveMonitorTo(m: MonitorDTO, targetAgentId: string) {
    try { await api.patch(`/api/monitors/${m.id}`, { agentId: targetAgentId }); } catch { /* ignore */ }
    setMoving(null);
    reload();
  }

  async function deleteMonitor(m: MonitorDTO) {
    if (!(await confirm({ title: "Delete monitor", message: `Delete "${m.name}"? Its history is kept but it stops being collected.`, confirmLabel: "Delete" }))) return;
    try {
      await api.del(`/api/monitors/${m.id}`);
      reload();
    } catch {
      setActionError("Failed to delete monitor.");
    }
  }

  const live = logsFor(id);

  // History (oldest-first) followed by the live tail, newest at the bottom.
  const lines = useMemo<ConsoleLine[]>(
    () => [...logs.map(toConsole), ...live.map(toConsole)],
    [logs, live],
  );

  // Section data, hoisted so the tab bar can show/hide DB/Storage/Clients tabs.
  const dbs = useMemo(
    () => monitors.filter((m) => m.type === "database").map((m) => ({ id: m.id, name: m.name, unit: unitFor(id, m.name) })).filter((d) => d.unit?.meta?.db),
    [monitors, id, unitFor],
  );
  const sts = useMemo(
    () => monitors.filter((m) => m.type === "storage").map((m) => ({ id: m.id, name: m.name, serverSide: (m.config as { server?: unknown })?.server === true, basePath: String((m.config as { path?: unknown })?.path ?? ""), unit: unitFor(id, m.name) })).filter((d) => d.unit?.meta?.storage),
    [monitors, id, unitFor],
  );
  const snmps = useMemo(
    () => monitors.filter((m) => m.type === "snmp").map((m) => ({ id: m.id, name: m.name, unit: unitFor(id, m.name) })).filter((d) => d.unit?.meta?.snmp),
    [monitors, id, unitFor],
  );
  const clients = useMemo(
    () => monitors.flatMap((m) => (unitFor(id, m.name)?.meta?.clients ?? []).map((c) => ({ ...c, service: m.name }))),
    [monitors, id, unitFor],
  );

  const tabs = useMemo(
    () => [
      { key: "monitors", label: `Monitors (${monitors.length})` },
      ...(dbs.length ? [{ key: "databases", label: `Databases (${dbs.length})` }] : []),
      ...(sts.length ? [{ key: "storage", label: `Storage (${sts.length})` }] : []),
      ...(snmps.length ? [{ key: "snmp", label: `SNMP (${snmps.length})` }] : []),
      ...(clients.length ? [{ key: "clients", label: `Clients (${clients.length})` }] : []),
      ...(agent?.kind !== "device" ? [{ key: "metrics", label: "Metrics" }] : []),
      { key: "logs", label: "Live logs" },
      { key: "deploy", label: "Deploy log" },
    ],
    [monitors.length, dbs.length, sts.length, snmps.length, clients.length, agent?.kind],
  );

  // Auto-scroll the console to the bottom as new lines arrive (toggle-able). Pausing
  // also turns off automatically if the user scrolls up to read older lines.
  const consoleRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  useEffect(() => {
    if (tab !== "logs" || !autoScroll) return;
    // rAF so the freshly-mounted/updated console has its final scrollHeight (fixes
    // "stuck at top" when the Live logs tab first opens).
    const raf = requestAnimationFrame(() => {
      const el = consoleRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [lines.length, autoScroll, tab]);
  const onConsoleScroll = () => {
    const el = consoleRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(atBottom);
  };

  async function runAction(fn: () => Promise<void>, note: string) {
    setActionError(null);
    setActionNote(null);
    try {
      await fn();
      setActionNote(note);
      reload();
    } catch {
      setActionError("Action failed. Please try again.");
    }
  }

  if (loading) return <Spinner label="Loading agent…" />;

  if (error || !agent) {
    return (
      <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
        {error ?? "Agent not found."}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            {renaming !== null ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const name = renaming.trim();
                  if (name && name !== agent.name) { try { await api.patch(`/api/agents/${agent.id}`, { name }); reload(); } catch { /* ignore */ } }
                  setRenaming(null);
                }}
                className="flex items-center gap-2"
              >
                <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setRenaming(null); }} className="rounded-md border border-sky-500 bg-slate-950 px-2 py-1 text-lg font-semibold text-slate-100 outline-none" />
                <button type="submit" className="text-xs text-sky-400 hover:text-sky-300">Save</button>
                <button type="button" onClick={() => setRenaming(null)} className="text-xs text-slate-500 hover:text-slate-300">Cancel</button>
              </form>
            ) : (
              <>
                <h1 className="text-xl font-semibold text-slate-100">{agent.name}</h1>
                <button type="button" onClick={() => setRenaming(agent.name)} title="Rename" className="text-slate-500 hover:text-slate-300">✎</button>
              </>
            )}
            <StatusBadge status={agent.status} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
            {agent.kind === "device" ? (
              <>
                <span>Agentless device</span>
                <span>Host: {agent.address ?? "—"}</span>
                <span>Last update: {formatWhen(agent.lastSeenAt)}</span>
              </>
            ) : (
              <>
                <span>Version: {agent.version ?? "—"}</span>
                <span>Built: {agent.buildTime ? formatWhen(agent.buildTime) : "—"}</span>
                <span>Platform: {agent.platform ?? "—"}</span>
                <span>Last seen: {formatWhen(agent.lastSeenAt)}</span>
                {liveHost?.cpuPct != null ? <span>CPU: {Math.round(liveHost.cpuPct)}%</span> : null}
                {liveHost?.memPct != null ? <span>RAM: {Math.round(liveHost.memPct)}%</span> : null}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canApprove && agent.status !== "approved" ? (
            <button
              type="button"
              onClick={() => runAction(() => approve(agent.id), "Agent approved.")}
              className="rounded-md border border-emerald-600/50 px-2.5 py-1 text-xs text-emerald-300 transition-colors hover:bg-emerald-500/10"
            >
              Approve
            </button>
          ) : null}
          {canRestart && agent.status === "approved" && agent.kind !== "device" ? (
            <button
              type="button"
              onClick={() =>
                void (async () => {
                  if (await confirm({ title: "Restart agent", message: `Restart "${agent.name}"? The agent process will stop and be relaunched by its supervisor.`, confirmLabel: "Restart", danger: false }))
                    await runAction(() => api.post(`/api/agents/${agent.id}/restart`, {}), "Restart queued.");
                })()
              }
              className="rounded-md border border-sky-600/50 px-2.5 py-1 text-xs text-sky-300 transition-colors hover:bg-sky-500/10"
            >
              Restart
            </button>
          ) : null}
          {canUpdate && agent.status === "approved" && agent.kind !== "device" ? (
            <button
              type="button"
              onClick={() =>
                void (async () => {
                  if (!(await confirm({ title: "Update agent", message: `Update "${agent.name}" to the latest built version? The agent downloads the new binary and restarts itself.`, confirmLabel: "Update", danger: false }))) return;
                  setActionError(null);
                  setActionNote(null);
                  try {
                    const r = await api.post<{ alreadyUpToDate?: boolean; latestVersion?: string; delivered?: boolean }>(`/api/agents/${agent.id}/update`, {});
                    if (r.alreadyUpToDate) setActionNote(`Already up to date (v${r.latestVersion}).`);
                    else setActionNote(r.delivered ? "Update queued." : "Update queued (agent offline — applies on reconnect).");
                    reload();
                  } catch {
                    setActionError("Action failed. Please try again.");
                  }
                })()
              }
              className="rounded-md border border-sky-600/50 px-2.5 py-1 text-xs text-sky-300 transition-colors hover:bg-sky-500/10"
            >
              Update
            </button>
          ) : null}
          {canWrite && agent.status !== "revoked" ? (
            <button
              type="button"
              onClick={() =>
                void (async () => {
                  if (await confirm({ title: "Revoke agent", message: `Revoke "${agent.name}"? It will immediately lose the ability to send telemetry until re-approved.`, confirmLabel: "Revoke" }))
                    await runAction(() => revoke(agent.id), "Agent revoked.");
                })()
              }
              className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 transition-colors hover:bg-rose-500/10"
            >
              Revoke
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={() =>
                void (async () => {
                  if (await confirm({ title: "Delete agent", message: `Permanently delete "${agent.name}" and ALL its data — monitors, metrics, folder/SNMP history, events, logs and uptime? This cannot be undone.`, confirmLabel: "Delete everything", danger: true })) {
                    try { await api.del(`/api/agents/${agent.id}`); navigate(agent.kind === "device" ? "/devices" : "/agents"); }
                    catch { /* ignore */ }
                  }
                })()
              }
              className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/10"
            >
              Delete
            </button>
          ) : null}
          {canWrite && agent.status === "approved" && agent.kind !== "device" ? (
            <label className="flex items-center gap-1.5 text-xs text-slate-400" title="Collect/push interval for this agent — applied live, no restart. 'Default' uses the global setting.">
              <span>Push every</span>
              <select
                value={agent.pushIntervalSec ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  void runAction(() => api.patch(`/api/agents/${agent.id}`, { pushIntervalSec: v }), "Push interval updated.");
                }}
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
              >
                <option value="">Default</option>
                {AGENT_PUSH_INTERVALS.map((o) => <option key={o.sec} value={o.sec}>{o.label}</option>)}
              </select>
            </label>
          ) : null}
          {canWrite && agent.status === "approved" && agent.kind !== "device" ? (
            <label className="flex items-center gap-1.5 text-xs text-slate-400" title="Verbose debug logging for this agent — applied live, no restart. Use briefly while diagnosing.">
              <input
                type="checkbox"
                checked={agent.debug}
                onChange={(e) => void runAction(() => api.patch(`/api/agents/${agent.id}`, { debug: e.target.checked }), `Debug logging ${e.target.checked ? "enabled" : "disabled"}.`)}
                className="h-3.5 w-3.5 accent-amber-500"
              />
              <span className={agent.debug ? "text-amber-300" : ""}>Debug logs</span>
            </label>
          ) : null}
        </div>
      </header>

      {actionError ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {actionError}
        </div>
      ) : null}
      {actionNote ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {actionNote}
        </div>
      ) : null}

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 border-b border-slate-800">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${tab === t.key ? "border-sky-400 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Monitors */}
      {tab === "monitors" ? (
      <section className="space-y-3">
        {canManageMonitors ? (
          <div className="flex justify-end">
            <button type="button" onClick={() => setMonitorEditor({ monitor: null })} className="rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-sky-400">
              Add monitor
            </button>
          </div>
        ) : null}
        <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Health</th>
                <th className="px-4 py-3 font-medium">PID</th>
                <th className="px-4 py-3 font-medium">CPU</th>
                <th className="px-4 py-3 font-medium">Mem</th>
                <th className="px-4 py-3 font-medium">Uptime</th>
                <th className="px-4 py-3 font-medium">Ports</th>
                <th className="px-4 py-3 font-medium">Clients</th>
                {canManageMonitors ? <th className="px-4 py-3 font-medium text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {monitors.length === 0 ? (
                <tr>
                  <td colSpan={canManageMonitors ? 10 : 9} className="px-4 py-6 text-slate-500">
                    No monitors configured for this agent.
                  </td>
                </tr>
              ) : (
                monitors.map((m) => {
                  const unit = unitFor(id, m.name);
                  const status = unit?.status ?? (m.enabled ? "UNKNOWN" : "DOWN");
                  const meta = unit?.meta ?? null;
                  const dash = <span className="text-slate-600">—</span>;
                  return (
                  <tr key={m.id} className="text-slate-200">
                    <td className="px-4 py-3" title={meta?.exePath ?? undefined}>
                      {m.name}
                      {meta?.user ? <div className="text-xs text-slate-500">{meta.user}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{m.type}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <StatusBadge status={status} />
                        {unit?.latencyMs != null ? <span className="text-xs tabular-nums text-slate-400">{unit.latencyMs.toFixed(0)} ms</span> : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{unit?.pid ?? dash}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{meta?.cpuPercent != null ? `${meta.cpuPercent.toFixed(0)}%` : dash}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{meta?.memMB != null ? `${meta.memMB.toFixed(0)} MB` : dash}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{meta?.uptimeSec != null ? fmtUptime(meta.uptimeSec) : dash}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{meta?.listenPorts?.length ? meta.listenPorts.join(", ") : dash}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{meta?.clientCount ?? dash}</td>
                    {canManageMonitors ? (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setMonitorEditor({ monitor: m })} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500">Edit</button>
                          {(m.config as { default?: unknown })?.default === true ? (
                            <span className="px-2.5 py-1 text-xs text-slate-600" title="Auto-provisioned reachability ping">auto</span>
                          ) : (
                            <>
                              <button type="button" onClick={() => setMoving(m)} title="Move to another agent/device (consolidate one device into one object)" className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500">Move</button>
                              <button type="button" onClick={() => void deleteMonitor(m)} className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/10">Delete</button>
                            </>
                          )}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {(() => {
          const ping = monitors.find((m) => m.type === "ping");
          return ping ? <PingHistory monitorId={ping.id} name={ping.name} /> : null;
        })()}
      </section>
      ) : null}

      {/* Databases (SQL Server health for database monitors) */}
      {tab === "databases" ? (
        <section className="space-y-3">
          {dbs.map((d) => (
            <DatabasePanel key={d.id} monitorId={d.id} name={d.name} db={d.unit!.meta!.db!} status={d.unit!.status} />
          ))}
        </section>
      ) : null}

      {/* Storage (NAS/SMB capacity for storage monitors) */}
      {tab === "storage" ? (
        <section className="space-y-3">
          {sts.map((d) => (
            <StoragePanel key={d.id} monitorId={d.id} name={d.name} storage={d.unit!.meta!.storage!} status={d.unit!.status} serverSide={d.serverSide} basePath={d.basePath} />
          ))}
        </section>
      ) : null}

      {/* SNMP (device OID readings, polled server-side) */}
      {tab === "snmp" ? (
        <section className="space-y-3">
          {snmps.map((d) => (
            <SnmpPanel key={d.id} monitorId={d.id} name={d.name} snmp={d.unit!.meta!.snmp!} status={d.unit!.status} />
          ))}
        </section>
      ) : null}

      {/* Connected clients (aggregated across this host's services) */}
      {tab === "clients" ? (
        <ClientsTable clients={clients} metaByIp={clientMetaByIp} canEdit={canEditClients} onEdit={setEditClient} />
      ) : null}

      {/* Host CPU/RAM metrics */}
      {tab === "metrics" ? <HostMetricsChart agentId={id} /> : null}

      {/* Live logs */}
      {tab === "logs" ? (
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-100">Live logs</h2>
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden />
            Live
          </span>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
            <input type="checkbox" checked={autoScroll} onChange={(e) => { setAutoScroll(e.target.checked); if (e.target.checked && consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight; }} className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-950" />
            Auto-scroll
          </label>
        </div>
        <div
          ref={consoleRef}
          onScroll={onConsoleScroll}
          className="h-96 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs leading-relaxed"
        >
          {lines.length === 0 ? (
            <div className="text-slate-600">No log lines yet.</div>
          ) : (
            lines.map((l, i) => (
              <div key={`${l.ts}-${i}`} className="whitespace-pre-wrap break-words">
                <span className="text-slate-600">{formatWhen(l.ts)}</span>{" "}
                <span className={levelClass(l.level)}>[{l.level}]</span>{" "}
                <span className="text-slate-500">{l.category}</span>{" "}
                <span className={levelClass(l.level)}>{l.message}</span>
              </div>
            ))
          )}
        </div>
      </section>
      ) : null}

      {/* Deploy / update log (restart + self-update commands, newest first) */}
      {tab === "deploy" ? (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-100">Deploy / update log</h2>
        <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {commands.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-slate-500">
                    No commands issued yet.
                  </td>
                </tr>
              ) : (
                commands.map((c) => (
                  <tr key={c.id} className="text-slate-200">
                    <td className="px-4 py-3">{c.type}</td>
                    <td className="px-4 py-3 text-slate-400">{c.status}</td>
                    <td className="px-4 py-3 text-slate-400">{formatWhen(c.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      {monitorEditor ? (
        <MonitorEditorModal
          agentId={id}
          agentKind={agent.kind}
          monitor={monitorEditor.monitor}
          onClose={() => setMonitorEditor(null)}
          onSaved={() => reload()}
        />
      ) : null}

      {moving ? (
        <Modal title={`Move "${moving.name}"`} onClose={() => setMoving(null)}>
          <p className="mb-3 text-sm text-slate-400">
            Move this monitor to another agent or device, so all of one physical device's monitoring lives in a single object.
            {moving.type === "snmp" || (moving.config as { server?: unknown })?.server === true ? " (server-side — keeps working on any agent)." : " Note: agent-collected monitors only report on an agent that can actually reach the target."}
          </p>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {allAgents.filter((a) => a.id !== id).map((a) => (
              <button key={a.id} type="button" onClick={() => void moveMonitorTo(moving, a.id)}
                className="flex w-full items-center justify-between rounded-md border border-slate-700 px-3 py-2 text-left text-sm text-slate-200 hover:border-sky-500 hover:bg-slate-800/50">
                <span>{a.name}</span>
                <span className="text-xs text-slate-500">{a.kind === "device" ? "device" : "agent"}{a.address ? ` · ${a.address}` : ""}</span>
              </button>
            ))}
            {allAgents.filter((a) => a.id !== id).length === 0 ? <p className="text-sm text-slate-500">No other agents/devices to move to.</p> : null}
          </div>
        </Modal>
      ) : null}

      {editClient ? (
        <Modal title={`Client ${editClient.ip}`} onClose={() => setEditClient(null)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                await saveClientMeta(editClient.ip, { hostname: editClient.hostname.trim() || null, description: editClient.description.trim() || null });
                setEditClient(null);
              })();
            }}
          >
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Custom name (overrides DNS)</span>
              <input
                autoFocus
                value={editClient.hostname}
                onChange={(e) => setEditClient({ ...editClient, hostname: e.target.value })}
                placeholder="e.g. HMI-Line-3"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Description</span>
              <textarea
                value={editClient.description}
                onChange={(e) => setEditClient({ ...editClient, description: e.target.value })}
                rows={3}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditClient(null)} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500">Cancel</button>
              <button type="submit" className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500">Save</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
