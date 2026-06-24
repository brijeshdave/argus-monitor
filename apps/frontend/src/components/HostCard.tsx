/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Host-centric Overview card: one card per monitored host
 * showing two always-visible layer pills — Host (network reachable, from the
 * server-side ping) and Agent (online/offline) — then the host's monitors nested
 * beneath as status chips, an overall rollup badge, and a link to the host detail.
 * Built from live WS data + the REST monitor list; no per-card fetch.
 */
import { Link } from "react-router-dom";
import { AlarmClock, Check, ChevronRight, CircleHelp, Cpu, Database, HardDrive, MemoryStick, Radio, Users, Wifi, WifiOff, X, type LucideIcon } from "lucide-react";
import type { AgentDTO, MonitorDTO } from "@argus/shared";
import type { LiveUnit } from "@argus/shared";

// Status → colour / icon (chips render inline-coloured).
const STATUS_COLOR: Record<string, string> = {
  UP: "var(--color-up)", HANG: "var(--color-hang)", DEGRADED: "var(--color-degraded)", DOWN: "var(--color-down)", UNKNOWN: "var(--color-unknown)",
};
const STATUS_ICON: Record<string, LucideIcon> = {
  UP: Check, HANG: AlarmClock, DEGRADED: AlarmClock, DOWN: X, UNKNOWN: CircleHelp,
};

type Overall = "UP" | "DEGRADED" | "DOWN" | "UNKNOWN";
type Tone = "up" | "degraded" | "down" | "unknown";

/** Compact byte size (NAS capacity labels). */
function fmtBytes(b: number | null | undefined): string {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

const TONE: Record<string, Tone> = { UP: "up", DEGRADED: "degraded", HANG: "degraded", DOWN: "down", UNKNOWN: "unknown" };
const PILL: Record<Tone, string> = {
  up: "bg-status-up/10 text-status-up ring-status-up/30",
  degraded: "bg-status-degraded/10 text-status-degraded ring-status-degraded/30",
  down: "bg-status-down/10 text-status-down ring-status-down/30",
  unknown: "bg-status-unknown/10 text-status-unknown ring-status-unknown/30",
};

/** Roll a host's monitor statuses into one overall: any DOWN→DOWN, any bad→DEGRADED. */
function rollup(statuses: string[]): Overall {
  if (statuses.length === 0) return "UNKNOWN";
  if (statuses.includes("DOWN")) return "DOWN";
  if (statuses.some((s) => s === "DEGRADED" || s === "HANG")) return "DEGRADED";
  if (statuses.every((s) => s === "UP")) return "UP";
  return "UNKNOWN";
}

/** Colour a usage bar by load: green < 75, amber < 90, red ≥ 90. */
function barColor(pct: number): string {
  if (pct >= 90) return "bg-status-down";
  if (pct >= 75) return "bg-status-degraded";
  return "bg-status-up";
}

function Stat({ icon, label, value, unit, pct }: { icon: React.ReactNode; label: string; value: string; unit?: string; pct: number | null }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[0.65rem] uppercase tracking-wide text-slate-500">{icon}<span>{label}</span></div>
      <div className="font-mono text-xl font-semibold leading-none text-slate-100">
        {value}{unit ? <span className="ml-0.5 text-xs font-normal text-slate-500">{unit}</span> : null}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${pct == null ? "" : barColor(pct)}`} style={{ width: `${pct == null ? 0 : Math.max(2, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}

function LayerPill({ icon, label, tone, text }: { icon: React.ReactNode; label: string; tone: Tone; text: string }) {
  return (
    <span className={`flex flex-1 items-center gap-2 rounded-lg px-3 py-2 ring-1 ${PILL[tone]}`}>
      <span className="flex">{icon}</span>
      <span className="text-[0.7rem] uppercase tracking-wide text-slate-500">{label}</span>
      <span className="ml-auto text-sm font-bold">{text}</span>
    </span>
  );
}

export function HostCard({
  agent, monitors, online, cpuPct, memPct, unitFor, compact = false,
}: {
  agent: AgentDTO;
  monitors: MonitorDTO[];
  online: boolean;
  cpuPct?: number | null;
  memPct?: number | null;
  unitFor: (sourceId: string, entity: string) => LiveUnit | undefined;
  compact?: boolean;
}) {
  const ping = monitors.find((m) => m.type === "ping" && (m.config as { default?: unknown }).default === true);
  const others = monitors.filter((m) => m !== ping);
  const pingUnit = ping ? unitFor(agent.id, ping.name) : undefined;
  const reachable = pingUnit ? pingUnit.status === "UP" : null;
  const latency = pingUnit?.latencyMs ?? null;

  // A device is agentless (NAS/switch/UPS…): it has no control socket, so its health
  // comes purely from its (server-side) monitors, not from an "online" pill.
  const isDevice = agent.kind === "device";
  const monStatus = (m: MonitorDTO): string => unitFor(agent.id, m.name)?.status ?? (m.enabled ? "UNKNOWN" : "DOWN");
  // The card's third gauge (after CPU/RAM) is ROLE-AWARE — clients only make sense
  // for client-facing services, so DB / NAS / SNMP hosts show their own metric
  // instead. Connected clients = UNIQUE remote IPs across the host's services
  // (deduped — one client with many connections counts once).
  const hasClientMonitors = others.some((m) => m.type === "service" || m.type === "process");
  const clientIPs = new Set<string>();
  for (const m of others) {
    for (const c of unitFor(agent.id, m.name)?.meta?.clients ?? []) {
      if (c.ip) clientIPs.add(c.ip);
    }
  }
  const uniqueClients = clientIPs.size;
  // Database connections (active sessions) summed across this host's DB monitors.
  const dbUnits = others.filter((m) => m.type === "database");
  const dbConns = dbUnits.reduce((n, m) => {
    const d = unitFor(agent.id, m.name)?.meta?.db;
    return n + (d?.activeSessions ?? d?.connections ?? 0);
  }, 0);
  // Show Clients only when the host is client-facing AND has clients right now;
  // otherwise fall back to a DB-connections gauge for database hosts.
  const showClients = !isDevice && hasClientMonitors && uniqueClients > 0;
  const showDbConns = !isDevice && !showClients && dbUnits.length > 0;
  const live = isDevice || online;
  const overall = live ? rollup((isDevice ? monitors : others).map(monStatus)) : "UNKNOWN";
  const accent: Tone = live ? (TONE[overall] ?? "unknown") : "unknown";
  // Split monitors into services vs databases.
  const services = others.filter((m) => m.type !== "database");
  const dbs = others.filter((m) => m.type === "database");
  const upCount = services.filter((m) => monStatus(m) === "UP").length;
  const dbUp = dbs.filter((m) => monStatus(m) === "UP").length;

  // Compact one-line card (dense list / scrolling views).
  if (compact) {
    return (
      <article className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
        <span className={`absolute inset-y-0 left-0 w-1 ${{ up: "bg-status-up", degraded: "bg-status-degraded", down: "bg-status-down", unknown: "bg-status-unknown" }[accent]}`} />
        <Link to={`/agents/${agent.id}`} className="flex items-center gap-3 py-2.5 pl-4 pr-3 hover:bg-slate-800/40">
          <span className={`status-led status-led--${accent}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-slate-100">{agent.name}</div>
            <div className="truncate font-data text-[0.68rem] text-slate-500">{agent.hostname ?? agent.address ?? agent.id}</div>
          </div>
          {online && !isDevice ? (
            <div className="hidden shrink-0 items-center gap-3 font-data text-xs text-slate-400 sm:flex">
              <span title="CPU">CPU {cpuPct != null ? `${Math.round(cpuPct)}%` : "—"}</span>
              <span title="RAM">RAM {memPct != null ? `${Math.round(memPct)}%` : "—"}</span>
              {showClients ? <span title="Unique connected clients">{uniqueClients}👤</span> : showDbConns ? <span title="Active DB connections">{dbConns} db</span> : null}
            </div>
          ) : null}
          <span className="shrink-0 font-data text-[0.78rem]" style={{ color: upCount === services.length && live ? "var(--color-up)" : "var(--color-text-secondary)" }}>
            {services.length > 0 ? `${upCount}/${services.length}` : dbs.length > 0 ? `${dbUp}/${dbs.length}` : "—"}
          </span>
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider ring-1 ${live ? PILL[accent] : PILL.unknown}`}>
            {live ? overall : "OFFLINE"}
          </span>
        </Link>
      </article>
    );
  }

  return (
    <article className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
      <span className={`absolute inset-y-0 left-0 w-1 ${{ up: "bg-status-up", degraded: "bg-status-degraded", down: "bg-status-down", unknown: "bg-status-unknown" }[accent]}`} />
      <div className="p-4 pl-5">
        {/* Header */}
        <div className="mb-3 flex items-center gap-3">
          <span className={`status-led status-led--${accent}`} aria-hidden />
          <div className="min-w-0">
            <Link to={`/agents/${agent.id}`} className="block truncate font-semibold text-slate-100 hover:underline">
              {agent.name}
            </Link>
            <div className="truncate font-mono text-[0.72rem] text-slate-500">{agent.hostname ?? agent.address ?? agent.id}</div>
          </div>
          <span className={`ml-auto rounded-md px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wider ring-1 ${live ? PILL[accent] : PILL.unknown}`}>
            {live ? overall : "OFFLINE"}
          </span>
        </div>

        {/* Layer pills: Host (ping) + Agent online / Device kind */}
        <div className="mb-4 flex items-stretch gap-2.5">
          <LayerPill
            icon={reachable === false ? <WifiOff size={16} /> : <Wifi size={16} />}
            label="Host"
            tone={reachable === false ? "down" : reachable ? "up" : "unknown"}
            text={reachable === false ? "Unreachable" : reachable ? (latency != null ? `Up · ${latency.toFixed(0)}ms` : "Up") : "—"}
          />
          {isDevice ? (
            <LayerPill icon={<HardDrive size={16} />} label="Type" tone="up" text="Device" />
          ) : (
            <LayerPill icon={<Radio size={16} />} label="Agent" tone={online ? "up" : "down"} text={online ? "Online" : "Offline"} />
          )}
        </div>

        {/* Offline reason (real agents) — explain WHY via the independent ping probe */}
        {!isDevice && !online && (
          <div className={`mb-4 flex animate-pulse items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-[0.8rem] font-semibold ring-1 ${reachable === false ? "bg-status-down/10 text-status-down ring-status-down/30" : "bg-status-degraded/10 text-status-degraded ring-status-degraded/30"}`}>
            <WifiOff size={16} />
            {reachable === false ? "Host unreachable — network / power" : reachable ? "Agent not responding — host is reachable" : "Signal lost — agent not reporting"}
          </div>
        )}

        {/* Host gauges (real agents only). Third gauge is role-aware: Clients for
            client-facing hosts (when any are connected), else DB connections for
            database hosts, else just CPU/RAM. NAS capacity shows as bars below. */}
        {online && !isDevice && (
          <div className={`mb-4 grid gap-2.5 ${showClients || showDbConns ? "grid-cols-3" : "grid-cols-2"}`}>
            <Stat icon={<Cpu size={13} />} label="CPU" value={cpuPct != null ? Math.round(cpuPct).toString() : "—"} unit={cpuPct != null ? "%" : undefined} pct={cpuPct ?? null} />
            <Stat icon={<MemoryStick size={13} />} label="RAM" value={memPct != null ? Math.round(memPct).toString() : "—"} unit={memPct != null ? "%" : undefined} pct={memPct ?? null} />
            {showClients ? <Stat icon={<Users size={13} />} label="Clients" value={uniqueClients.toString()} pct={Math.min(100, uniqueClients)} /> : null}
            {showDbConns ? <Stat icon={<Database size={13} />} label="DB conns" value={dbConns.toString()} pct={Math.min(100, dbConns)} /> : null}
          </div>
        )}

        {/* Storage capacity (NAS card) — capacity bar per storage monitor */}
        {(() => {
          const shares = monitors
            .map((m) => ({ m, s: unitFor(agent.id, m.name)?.meta?.storage }))
            .filter((x): x is { m: MonitorDTO; s: NonNullable<typeof x.s> } => !!x.s && x.s.reachable);
          if (shares.length === 0) return null;
          return (
            <div className="mb-3 space-y-1.5">
              {shares.map(({ m, s }) => {
                const pct = s.usedPct ?? 0;
                const col = pct >= 90 ? "bg-status-down" : pct >= 75 ? "bg-status-degraded" : "bg-status-up";
                return (
                  <div key={m.id}>
                    <div className="flex items-baseline justify-between text-[0.78rem]">
                      <span className="truncate text-slate-300">{m.name}</span>
                      <span className="font-mono text-slate-400">{fmtBytes(s.usedBytes)} / {fmtBytes(s.totalBytes)} · {pct.toFixed(0)}%</span>
                    </div>
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div className={`h-full rounded-full ${col}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Service + database chips (status icon + colour) */}
        <div className="mb-3 flex flex-wrap gap-2">
          {services.map((m) => {
            const st = monStatus(m);
            const c = STATUS_COLOR[st] ?? STATUS_COLOR.UNKNOWN;
            const Ic = STATUS_ICON[st] ?? CircleHelp;
            return (
              <span key={m.id} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.82rem] font-medium"
                style={{ color: c, background: `${c}18`, border: `1px solid ${c}55` }} title={`${m.name} (${m.type}): ${st}`}>
                <Ic size={14} /> {m.name}
              </span>
            );
          })}
          {dbs.map((m) => {
            const st = monStatus(m);
            const c = STATUS_COLOR[st] ?? STATUS_COLOR.UNKNOWN;
            return (
              <span key={m.id} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.82rem] font-medium"
                style={{ color: c, background: `${c}18`, border: `1px solid ${c}55` }} title={`${m.name} (database): ${st}`}>
                <Database size={14} /> {m.name}
              </span>
            );
          })}
          {services.length === 0 && dbs.length === 0 && <span className="text-sm text-slate-500">No services reported</span>}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-slate-800 pt-3">
          {services.length > 0 ? (
            <span className="font-data text-[0.82rem]" style={{ color: upCount === services.length ? "var(--color-up)" : "var(--color-text-secondary)" }}>
              {upCount} / {services.length} services up
            </span>
          ) : dbs.length > 0 ? (
            <span className="font-data text-[0.82rem]" style={{ color: dbUp === dbs.length ? "var(--color-up)" : "var(--color-text-secondary)" }}>
              {dbUp} / {dbs.length} database{dbs.length === 1 ? "" : "s"} up
            </span>
          ) : (
            <span className="font-data text-[0.78rem] text-slate-500">no services</span>
          )}
          {reachable && latency != null ? <span className="font-data text-[0.72rem] text-slate-600" title="Host reachability round-trip">· ping {latency.toFixed(0)}ms</span> : null}
          <Link to={`/agents/${agent.id}`} className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-sky-300 hover:underline">
            Details <ChevronRight size={15} />
          </Link>
        </div>
      </div>
    </article>
  );
}
