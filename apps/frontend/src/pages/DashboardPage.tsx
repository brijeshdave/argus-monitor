/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Overview — the fleet dashboard: a clickable KPI strip
 * (Hosts / Operational / Need attention) over a responsive grid of live HostCards
 * that reflow by viewport width. Faults sort first. Live over the WS feed.
 * (No fleet-wide "Clients" KPI: client counts are per-monitor, not every host has one.)
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CircleCheckBig, Columns2, Columns3, LayoutGrid, Maximize, Rows3, Server, StretchHorizontal, TriangleAlert, X, type LucideIcon } from "lucide-react";
import type { AgentDTO, LiveUnit, MonitorDTO } from "@argus/shared";
import { useDashboard } from "@/hooks/useDashboard";
import { useLiveState } from "@/hooks/useLiveState";
import { Spinner } from "@/components/Spinner";
import { HostCard } from "@/components/HostCard";

type Overall = "UP" | "DEGRADED" | "DOWN" | "UNKNOWN";
type Filter = null | "up" | "attention";
type View = "details" | "compact" | "c1" | "c2" | "c3";

// Fixed dashboard presets (no per-knob customization — pick a layout).
const VIEWS: ReadonlyArray<{ key: View; label: string; icon: LucideIcon; grid: string; compact?: boolean }> = [
  { key: "details", label: "Details", icon: LayoutGrid, grid: "grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,400px),1fr))]" },
  { key: "compact", label: "Compact", icon: StretchHorizontal, grid: "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))]", compact: true },
  { key: "c1", label: "1 column", icon: Rows3, grid: "grid gap-3 grid-cols-1" },
  { key: "c2", label: "2 columns", icon: Columns2, grid: "grid gap-3 grid-cols-1 lg:grid-cols-2" },
  { key: "c3", label: "3 columns", icon: Columns3, grid: "grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3" },
];

/** A host's rolled-up overall, mirroring HostCard (offline real agent → UNKNOWN). */
function hostOverall(agent: AgentDTO, mons: MonitorDTO[], online: boolean, unitFor: (s: string, e: string) => LiveUnit | undefined): Overall {
  const isDevice = agent.kind === "device";
  if (!isDevice && !online) return "UNKNOWN";
  const scope = isDevice ? mons : mons.filter((m) => !(m.type === "ping" && (m.config as { default?: unknown }).default === true));
  const statuses = scope.map((m) => unitFor(agent.id, m.name)?.status ?? (m.enabled ? "UNKNOWN" : "DOWN"));
  if (statuses.length === 0) return "UNKNOWN";
  if (statuses.includes("DOWN")) return "DOWN";
  if (statuses.some((s) => s === "DEGRADED" || s === "HANG")) return "DEGRADED";
  if (statuses.every((s) => s === "UP")) return "UP";
  return "UNKNOWN";
}

const RANK: Record<Overall, number> = { DOWN: 0, DEGRADED: 1, UNKNOWN: 2, UP: 3 };
const isAttention = (o: Overall) => o === "DOWN" || o === "DEGRADED" || o === "UNKNOWN";

function Kpi({ icon: Icon, tone, value, label, active, onClick }: { icon: LucideIcon; tone: string; value: number; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-colors ${active ? "border-sky-500 bg-sky-500/10" : "border-slate-800 bg-slate-900/40"} ${onClick ? "hover:border-slate-600" : "cursor-default"}`}
    >
      <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-xl" style={{ background: `${tone}1f`, color: tone }}><Icon size={23} /></span>
      <div>
        <div className="text-[1.85rem] font-semibold leading-none tabular-nums text-slate-100">{value}</div>
        <div className="mt-1.5 text-[0.72rem] uppercase tracking-wider" style={{ color: active ? tone : "#64748b" }}>{label}</div>
      </div>
    </button>
  );
}

export function DashboardPage() {
  const { loading, error, agents, monitors } = useDashboard();
  const { connected, agents: liveAgents, unitFor } = useLiveState();
  const [filter, setFilter] = useState<Filter>(null);
  const [view, setView] = useState<View>(() => (localStorage.getItem("dashView") as View) || "details");
  useEffect(() => { localStorage.setItem("dashView", view); }, [view]);
  const viewCfg = VIEWS.find((v) => v.key === view) ?? VIEWS[0]!;

  const onlineById = useMemo(() => new Map(liveAgents.map((a) => [a.id, a.online])), [liveAgents]);
  const liveById = useMemo(() => new Map(liveAgents.map((a) => [a.id, a])), [liveAgents]);
  const monitorsByAgent = useMemo(() => {
    const m = new Map<string, MonitorDTO[]>();
    for (const mon of monitors) { const l = m.get(mon.agentId) ?? []; l.push(mon); m.set(mon.agentId, l); }
    return m;
  }, [monitors]);

  const annotated = useMemo(() => agents
    .filter((a) => a.status !== "revoked")
    .map((a) => {
      const mons = monitorsByAgent.get(a.id) ?? [];
      const online = onlineById.get(a.id) ?? false;
      const overall = hostOverall(a, mons, online, unitFor);
      return { a, mons, online, overall };
    }), [agents, monitorsByAgent, onlineById, unitFor]);

  const total = annotated.length;
  const operational = annotated.filter((h) => h.overall === "UP").length;
  const attention = annotated.filter((h) => isAttention(h.overall)).length;

  const sorted = useMemo(() => [...annotated]
    .sort((x, y) => (RANK[x.overall] - RANK[y.overall]) || (Number(y.online) - Number(x.online)) || x.a.name.localeCompare(y.a.name))
    .filter((h) => filter === null || (filter === "up" ? h.overall === "UP" : isAttention(h.overall))), [annotated, filter]);

  if (loading) return <Spinner label="Loading overview…" />;
  const toggle = (f: Filter) => () => setFilter((cur) => (cur === f ? null : f));

  return (
    <div className="space-y-4">
      {/* Heading + wallboard launch */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2.5 text-[1.4rem] font-bold text-slate-100"><Server size={22} className="text-sky-400" /> Fleet Overview</h1>
        <span className={`text-xs ${connected ? "text-status-up" : "text-slate-500"}`}>{connected ? "● live" : "○ offline"}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-slate-700 p-0.5">
            {VIEWS.map((v) => {
              const Icon = v.icon;
              return (
                <button key={v.key} type="button" onClick={() => setView(v.key)} title={v.label}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${view === v.key ? "bg-sky-500/15 text-sky-200" : "text-slate-400 hover:text-slate-200"}`}>
                  <Icon size={14} /><span className="hidden lg:inline">{v.label}</span>
                </button>
              );
            })}
          </div>
          <Link to="/wall" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-[0.85rem] font-medium text-slate-300 hover:border-slate-500" title="Open the fullscreen wallboard">
            <Maximize size={16} /> Wallboard
          </Link>
        </div>
      </div>
      <p className="text-[0.85rem] text-slate-500">{total > 0 ? `${total} monitored host${total !== 1 ? "s" : ""} · live` : "Live fleet status"}</p>

      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}

      {/* KPI strip (clickable filters) */}
      {total > 0 ? (
        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
          <Kpi icon={Server} tone="#38bdf8" value={total} label="Hosts" active={filter === null} onClick={() => setFilter(null)} />
          <Kpi icon={CircleCheckBig} tone="#22c55e" value={operational} label="Operational" active={filter === "up"} onClick={toggle("up")} />
          <Kpi icon={TriangleAlert} tone={attention > 0 ? "#ef4444" : "#64748b"} value={attention} label="Need attention" active={filter === "attention"} onClick={toggle("attention")} />
        </div>
      ) : null}

      {filter !== null ? (
        <div className="flex items-center gap-2 text-[0.82rem] text-slate-400">
          <span>Showing {sorted.length} {filter === "up" ? "operational" : "needs-attention"} of {total}</span>
          <button type="button" onClick={() => setFilter(null)} className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-0.5 text-xs hover:border-slate-500"><X size={12} /> Clear</button>
        </div>
      ) : null}

      {total === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/40 py-24 text-sm text-slate-500">
          <Server size={40} className="text-slate-600" />
          No hosts are reporting yet. Mint a connection key and install an agent to see data here.
        </div>
      ) : (
        <div className={viewCfg.grid}>
          {sorted.map((h) => (
            <HostCard key={h.a.id} agent={h.a} monitors={h.mons} online={h.online} cpuPct={liveById.get(h.a.id)?.cpuPct ?? null} memPct={liveById.get(h.a.id)?.memPct ?? null} unitFor={unitFor} compact={viewCfg.compact} />
          ))}
          {sorted.length === 0 ? <p className="text-sm text-slate-500">No hosts match this filter.</p> : null}
        </div>
      )}
    </div>
  );
}
