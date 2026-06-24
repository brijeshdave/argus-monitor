/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Report charts: turns a ReportDoc into the right set of visualisations for its
 * type (availability trend + per-monitor bars, incident timelines, storage growth
 * lines, inventory breakdowns, and an executive-summary dashboard). Purely
 * presentational — the page passes the document. The outer container carries an id
 * so the export layer can serialise the rendered SVGs into a printable PDF.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReportDoc } from "@/hooks/useReports";

export const REPORT_CHARTS_ID = "report-charts";

const GRID = "#232c38";
const TICK = { fill: "#8a9cb0", fontSize: 11 };
const TOOLTIP = { background: "#12161c", border: "1px solid #232c38", borderRadius: 8, color: "#eef3f9", fontSize: 12 };
const PIE_COLORS = ["#38bdf8", "#22c55e", "#f59e0b", "#a78bfa", "#ef4444", "#2dd4bf", "#fb7185", "#facc15", "#60a5fa"];

/** Availability colour ramp shared by uptime bars. */
function uptimeColor(pct: number): string {
  if (pct >= 99.5) return "#22c55e";
  if (pct >= 95) return "#84cc16";
  if (pct >= 80) return "#f59e0b";
  return "#ef4444";
}

function fmtDay(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtBytes(b: number | null | undefined): string {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function Panel({ title, children, height = 240 }: { title: string; children: React.ReactNode; height?: number }) {
  return (
    <figure data-chart-title={title} className="m-0 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <figcaption className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</figcaption>
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500">{label}</div>;
}

// ── Per-type chart blocks ───────────────────────────────────────────────────

type TrendPoint = { date: string; upPct: number | null };
type IncidentDay = { date: string; total: number; DOWN: number; HANG: number; DEGRADED: number };

function UptimeTrend({ trend }: { trend: TrendPoint[] }) {
  if (trend.length < 2) return null;
  return (
    <Panel title="Daily availability trend">
      <LineChart data={trend} margin={{ top: 5, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
        <XAxis dataKey="date" tickFormatter={fmtDay} tick={TICK} minTickGap={32} />
        <YAxis domain={[0, 100]} unit="%" tick={TICK} width={44} />
        <Tooltip contentStyle={TOOLTIP} formatter={(v) => [`${v}%`, "Uptime"]} labelFormatter={fmtDay} />
        <Line type="monotone" dataKey="upPct" name="Uptime %" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls />
      </LineChart>
    </Panel>
  );
}

function UptimeBars({ rows, title }: { rows: Array<{ label: string; uptimePct: number }>; title: string }) {
  if (rows.length === 0) return null;
  const data = rows.slice(0, 25);
  return (
    <Panel title={title} height={Math.max(200, data.length * 26 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} unit="%" tick={TICK} />
        <YAxis type="category" dataKey="label" tick={TICK} width={140} />
        <Tooltip contentStyle={TOOLTIP} formatter={(v) => [`${Number(v).toFixed(2)}%`, "Uptime"]} cursor={{ fill: "#ffffff08" }} />
        <Bar dataKey="uptimePct" radius={[0, 3, 3, 0]}>
          {data.map((r, i) => (
            <Cell key={i} fill={uptimeColor(r.uptimePct)} />
          ))}
        </Bar>
      </BarChart>
    </Panel>
  );
}

function IncidentsTimeline({ perDay }: { perDay: IncidentDay[] }) {
  if (perDay.length === 0) return <Empty label="No incidents in this window — nothing to chart." />;
  return (
    <Panel title="Incidents per day">
      <BarChart data={perDay} margin={{ top: 5, right: 12, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
        <XAxis dataKey="date" tickFormatter={fmtDay} tick={TICK} minTickGap={24} />
        <YAxis allowDecimals={false} tick={TICK} width={36} />
        <Tooltip contentStyle={TOOLTIP} labelFormatter={fmtDay} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="DOWN" stackId="s" name="Down" fill="#ef4444" />
        <Bar dataKey="HANG" stackId="s" name="Hang" fill="#f59e0b" />
        <Bar dataKey="DEGRADED" stackId="s" name="Degraded" fill="#a78bfa" radius={[3, 3, 0, 0]} />
      </BarChart>
    </Panel>
  );
}

function CountBars({ data, title, dataKey, nameKey, color }: { data: Array<Record<string, unknown>>; title: string; dataKey: string; nameKey: string; color: string }) {
  if (data.length === 0) return null;
  return (
    <Panel title={title} height={Math.max(180, data.length * 26 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={TICK} />
        <YAxis type="category" dataKey={nameKey} tick={TICK} width={140} />
        <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "#ffffff08" }} />
        <Bar dataKey={dataKey} fill={color} radius={[0, 3, 3, 0]} />
      </BarChart>
    </Panel>
  );
}

type StorageMon = { name: string; days: Array<{ date: string; usedPct: number | null }> };

function StorageGrowth({ monitors }: { monitors: StorageMon[] }) {
  const withData = monitors.filter((m) => m.days.length > 0);
  if (withData.length === 0) return <Empty label="No storage history in this window." />;
  // Merge per-share day series onto one date axis.
  const byDate = new Map<string, Record<string, number | string | null>>();
  for (const m of withData) {
    for (const d of m.days) {
      const row = byDate.get(d.date) ?? { date: d.date };
      row[m.name] = d.usedPct;
      byDate.set(d.date, row);
    }
  }
  const data = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return (
    <Panel title="Storage used % over time" height={Math.max(260, withData.length > 6 ? 320 : 260)}>
      <LineChart data={data} margin={{ top: 5, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
        <XAxis dataKey="date" tickFormatter={fmtDay} tick={TICK} minTickGap={32} />
        <YAxis domain={[0, 100]} unit="%" tick={TICK} width={44} />
        <Tooltip contentStyle={TOOLTIP} labelFormatter={fmtDay} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {withData.map((m, i) => (
          <Line key={m.name} type="monotone" dataKey={m.name} stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={1.75} dot={false} connectNulls />
        ))}
      </LineChart>
    </Panel>
  );
}

type StorageDetailMon = {
  name: string;
  current: { usedPct: number | null; usedBytes: number | null; totalBytes: number | null; freeBytes: number | null };
  days: Array<{ date: string; usedPct: number | null }>;
  topFolders: Array<{ folder: string; sizeBytes: number | null; fileCount: number | null; folderCount: number | null }>;
  capturedAt: string | null;
};

function FolderBars({ folders }: { folders: StorageDetailMon["topFolders"] }) {
  const data = folders.filter((f) => f.sizeBytes != null).slice(0, 25).map((f) => ({ ...f, folder: f.folder.length > 36 ? `…${f.folder.slice(-35)}` : f.folder }));
  if (data.length === 0) return <Empty label="No folder breakdown captured yet for this share." />;
  return (
    <Panel title="Largest folders" height={Math.max(220, data.length * 24 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => fmtBytes(Number(v))} tick={TICK} />
        <YAxis type="category" dataKey="folder" tick={{ ...TICK, fontSize: 10 }} width={210} />
        <Tooltip contentStyle={TOOLTIP} formatter={(v) => [fmtBytes(Number(v)), "Size"]} cursor={{ fill: "#ffffff08" }} />
        <Bar dataKey="sizeBytes" fill="#38bdf8" radius={[0, 3, 3, 0]} />
      </BarChart>
    </Panel>
  );
}

function StorageDetail({ monitors }: { monitors: StorageDetailMon[] }) {
  if (monitors.length === 0) return <Empty label="No storage monitors in scope." />;
  return (
    <div className="space-y-6">
      {monitors.map((m) => (
        <div key={m.name} className="space-y-4">
          <div className="text-sm font-semibold text-slate-200">{m.name}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Used" value={m.current.usedPct != null ? `${m.current.usedPct.toFixed(1)}%` : "—"} tone={uptimeColor(100 - (m.current.usedPct ?? 0))} />
            <Kpi label="Used space" value={fmtBytes(m.current.usedBytes)} />
            <Kpi label="Free space" value={fmtBytes(m.current.freeBytes)} />
            <Kpi label="Total capacity" value={fmtBytes(m.current.totalBytes)} />
          </div>
          <StorageGrowth monitors={[{ name: m.name, days: m.days }]} />
          <FolderBars folders={m.topFolders} />
        </div>
      ))}
    </div>
  );
}

type Series = { name: string; points: Array<{ date: string } & Record<string, number | null>> };

/** Merge several named day-series onto one date axis and draw a line each. */
function MultiLine({ title, series, valKey, suffix }: { title: string; series: Series[]; valKey: string; suffix: string }) {
  const withData = series.filter((s) => s.points.length > 0);
  if (withData.length === 0) return <Empty label="No samples captured in this window yet." />;
  const byDate = new Map<string, Record<string, number | string | null>>();
  for (const s of withData) {
    for (const p of s.points) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row[s.name] = p[valKey] ?? null;
      byDate.set(p.date, row);
    }
  }
  const data = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return (
    <Panel title={title} height={Math.max(240, withData.length > 8 ? 300 : 240)}>
      <LineChart data={data} margin={{ top: 5, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
        <XAxis dataKey="date" tickFormatter={fmtDay} tick={TICK} minTickGap={32} />
        <YAxis unit={suffix} tick={TICK} width={48} />
        <Tooltip contentStyle={TOOLTIP} labelFormatter={fmtDay} formatter={(v) => [`${v}${suffix}`, ""]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {withData.map((s, i) => (
          <Line key={s.name} type="monotone" dataKey={s.name} stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={1.75} dot={false} connectNulls />
        ))}
      </LineChart>
    </Panel>
  );
}

function Breakdown({ title, counts }: { title: string; counts: Array<{ name: string; value: number }> }) {
  if (counts.length === 0) return null;
  return (
    <Panel title={title}>
      <PieChart>
        <Pie data={counts} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e) => `${e.name}: ${e.value}`} labelLine={false}>
          {counts.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP} />
      </PieChart>
    </Panel>
  );
}

function tally<T>(items: T[], key: (t: T) => string): Array<{ name: string; value: number }> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it) || "—";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div data-kpi data-kpi-label={label} data-kpi-value={value} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-2xl font-semibold tabular-nums" style={{ color: tone ?? "#e2e8f0" }}>{value}</div>
      <div className="mt-1 text-[0.7rem] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

export function ReportCharts({ doc }: { doc: ReportDoc }) {
  const d = doc.data as Record<string, unknown>;

  let body: React.ReactNode = null;

  if (doc.type === "summary") {
    const s = d as {
      overallUptimePct: number;
      incidentCount: number;
      agentsTotal: number;
      monitorsTotal: number;
      monitorsEnabled: number;
      worstMonitors: Array<{ label: string; uptimePct: number }>;
      topIncidentMonitors: Array<{ entity: string; count: number }>;
      storageAlerts: Array<{ name: string; usedPct: number }>;
      uptimeTrend: TrendPoint[];
      incidentsPerDay: IncidentDay[];
    };
    body = (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Overall uptime" value={`${s.overallUptimePct.toFixed(2)}%`} tone={uptimeColor(s.overallUptimePct)} />
          <Kpi label="Incidents" value={String(s.incidentCount)} tone={s.incidentCount > 0 ? "#f87171" : "#22c55e"} />
          <Kpi label="Monitored hosts" value={String(s.agentsTotal)} />
          <Kpi label="Monitors (enabled)" value={`${s.monitorsEnabled}/${s.monitorsTotal}`} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <UptimeTrend trend={s.uptimeTrend} />
          <IncidentsTimeline perDay={s.incidentsPerDay} />
          <UptimeBars rows={s.worstMonitors} title="Lowest-availability monitors" />
          {s.topIncidentMonitors.length > 0 ? (
            <CountBars data={s.topIncidentMonitors} title="Most incident-prone monitors" dataKey="count" nameKey="entity" color="#fb7185" />
          ) : null}
          {s.storageAlerts.length > 0 ? (
            <CountBars data={s.storageAlerts} title="Storage at/over 75%" dataKey="usedPct" nameKey="name" color="#f59e0b" />
          ) : null}
        </div>
      </div>
    );
  } else if (doc.type === "uptime") {
    const u = d as { rows: Array<{ label: string; uptimePct: number }>; overallPct: number; trend: TrendPoint[] };
    body = (
      <div className="grid gap-4 lg:grid-cols-2">
        <UptimeTrend trend={u.trend} />
        <UptimeBars rows={u.rows} title="Availability by monitor" />
      </div>
    );
  } else if (doc.type === "incidents") {
    const inc = d as unknown as IncidentData;
    const top = tally(inc.items, (i) => i.entity).map((t) => ({ entity: t.name, count: t.value })).slice(0, 12);
    body = (
      <div className="grid gap-4 lg:grid-cols-2">
        <IncidentsTimeline perDay={inc.perDay} />
        <CountBars data={top} title="Incidents by monitor" dataKey="count" nameKey="entity" color="#fb7185" />
      </div>
    );
  } else if (doc.type === "resource") {
    const r = d as { hosts: Series[]; processes: Series[] };
    body = (
      <div className="space-y-4">
        {r.hosts.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <MultiLine title="Host CPU %" series={r.hosts} valKey="cpuPct" suffix="%" />
            <MultiLine title="Host memory %" series={r.hosts} valKey="memPct" suffix="%" />
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <MultiLine title="Process CPU %" series={r.processes} valKey="cpuPct" suffix="%" />
          <MultiLine title="Process memory (MB)" series={r.processes} valKey="memMb" suffix=" MB" />
        </div>
      </div>
    );
  } else if (doc.type === "storage") {
    const st = d as { monitors: StorageMon[] };
    body = <StorageGrowth monitors={st.monitors} />;
  } else if (doc.type === "storage-detail") {
    const st = d as { monitors: StorageDetailMon[] };
    body = <StorageDetail monitors={st.monitors} />;
  } else {
    // inventory
    const inv = d as {
      agents: Array<{ platform: string | null; status: string }>;
      monitors: Array<{ type: string; enabled: boolean }>;
    };
    body = (
      <div className="grid gap-4 lg:grid-cols-3">
        <Breakdown title="Monitors by type" counts={tally(inv.monitors, (m) => m.type)} />
        <Breakdown title="Agents by status" counts={tally(inv.agents, (a) => a.status)} />
        <Breakdown title="Agents by platform" counts={tally(inv.agents, (a) => a.platform ?? "unknown")} />
      </div>
    );
  }

  if (!body) return null;
  return <div id={REPORT_CHARTS_ID}>{body}</div>;
}

interface IncidentData {
  count: number;
  items: Array<{ entity: string; newStatus: string | null; ts: string }>;
  perDay: IncidentDay[];
}
