/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * SQL Server health panel: a metric grid of the key DMVs,
 * the top waits, and the currently-running sessions (normalized statements). Reads
 * the live DbSample carried in a database monitor's unit meta.
 */
import { useEffect, useState } from "react";
import type { DbSample } from "@argus/shared";
import { api } from "@/lib/api";
import { MetricChart } from "@/components/MetricChart";
import { Tabs, type TabItem } from "@/components/Tabs";

interface TrendPoint { ts: string; metrics: Record<string, number | null> }

function Metric({ label, value, unit }: { label: string; value: number | null | undefined; unit?: string }) {
  const shown = value == null ? "—" : Number.isInteger(value) ? value.toString() : value.toFixed(1);
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="text-[0.65rem] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-lg text-slate-100">
        {shown}
        {value != null && unit ? <span className="ml-0.5 text-xs text-slate-500">{unit}</span> : null}
      </div>
    </div>
  );
}

export function DatabasePanel({ monitorId, name, db, status }: { monitorId: string; name: string; db: DbSample; status: string }) {
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [period, setPeriod] = useState("hours=24");
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api.get<{ points: TrendPoint[] }>(`/api/monitors/${monitorId}/db-metrics?${period}`).then(
        (r) => !cancelled && setTrend(r.points),
        () => {},
      );
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [monitorId, period]);

  const chartData = trend.map((p) => ({
    t: new Date(p.ts).getTime(),
    cpu: typeof p.metrics?.cpuPercent === "number" ? p.metrics.cpuPercent : 0,
    sessions: typeof p.metrics?.activeSessions === "number" ? p.metrics.activeSessions : 0,
    batch: typeof p.metrics?.batchReqPerSec === "number" ? p.metrics.batchReqPerSec : 0,
  }));

  const overviewNode = (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      <Metric label="Uptime (min)" value={db.uptimeMin} />
      <Metric label="CPU" value={db.cpuPercent} unit="%" />
      <Metric label="Active sessions" value={db.activeSessions} />
      <Metric label="Connections" value={db.connections} />
      <Metric label="Blocked" value={db.blockedSessions} />
      <Metric label="Batch req/s" value={db.batchReqPerSec} />
      <Metric label="Buffer hit" value={db.bufferCacheHitPct} unit="%" />
      <Metric label="PLE" value={db.pleSeconds} unit="s" />
      <Metric label="SQL memory" value={db.totalServerMemoryMB} unit="MB" />
      <Metric label="IO read" value={db.ioReadLatencyMs} unit="ms" />
      <Metric label="IO write" value={db.ioWriteLatencyMs} unit="ms" />
      <Metric label="Deadlocks" value={db.deadlocks} />
    </div>
  );

  const historyNode = (
    <MetricChart
      title="CPU % · sessions · batch req/s"
      data={chartData}
      lines={[
        { key: "cpu", label: "CPU %", color: "#38bdf8" },
        { key: "sessions", label: "Sessions", color: "#22c55e" },
        { key: "batch", label: "Batch/s", color: "#f59e0b" },
      ]}
      period={period}
      onPeriod={setPeriod}
    />
  );

  const tabs: TabItem[] = [
    { key: "overview", label: "Overview", node: overviewNode },
    { key: "history", label: "History", node: historyNode },
  ];
  if (db.sessions && db.sessions.length > 0) {
    tabs.push({
      key: "sessions",
      label: `Sessions (${db.sessions.length})`,
      node: (
        <div className="overflow-x-auto rounded-md border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 text-slate-500">
              <tr><th className="px-2 py-1.5 font-medium">SID</th><th className="px-2 py-1.5 font-medium">Login</th><th className="px-2 py-1.5 font-medium">Host</th><th className="px-2 py-1.5 font-medium">Status</th><th className="px-2 py-1.5 font-medium">Elapsed</th><th className="px-2 py-1.5 font-medium">Statement</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {db.sessions.map((s) => (
                <tr key={s.sessionId} className="text-slate-300">
                  <td className="px-2 py-1 font-mono">{s.sessionId}</td>
                  <td className="px-2 py-1">{s.login || "—"}</td>
                  <td className="px-2 py-1">{s.host || "—"}</td>
                  <td className="px-2 py-1">{s.status || "—"}{s.blockedBy ? ` (blocked by ${s.blockedBy})` : ""}</td>
                  <td className="px-2 py-1 font-mono">{s.elapsedMs != null ? `${Math.round(s.elapsedMs)}ms` : "—"}</td>
                  <td className="max-w-md truncate px-2 py-1 font-mono text-slate-400" title={s.statement ?? ""}>{s.statement || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    });
  }
  if (db.queries && db.queries.length > 0) {
    tabs.push({
      key: "queries",
      label: `Top queries (${db.queries.length})`,
      node: (
        <div className="overflow-x-auto rounded-md border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 text-slate-500">
              <tr><th className="px-2 py-1.5 font-medium">Query (normalized)</th><th className="px-2 py-1.5 font-medium">Execs</th><th className="px-2 py-1.5 font-medium">Total</th><th className="px-2 py-1.5 font-medium">Avg</th><th className="px-2 py-1.5 font-medium">Reads</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {db.queries.map((q) => (
                <tr key={q.queryHash} className="text-slate-300">
                  <td className="max-w-md truncate px-2 py-1 font-mono text-slate-400" title={q.normalizedText}>{q.normalizedText}</td>
                  <td className="px-2 py-1 font-mono">{q.execCount}</td>
                  <td className="px-2 py-1 font-mono">{Math.round(q.totalDurationMs)}ms</td>
                  <td className="px-2 py-1 font-mono">{q.avgDurationMs.toFixed(1)}ms</td>
                  <td className="px-2 py-1 font-mono">{q.logicalReads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    });
  }
  if (db.topWaits && db.topWaits.length > 0) {
    tabs.push({
      key: "waits",
      label: "Top waits",
      node: (
        <div className="flex flex-wrap gap-2">
          {db.topWaits.map((w) => (
            <span key={w.type} className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">{w.type} <span className="text-slate-500">{Math.round(w.waitMs)}ms</span></span>
          ))}
        </div>
      ),
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-slate-100">{name}</h3>
        <span className="text-xs uppercase tracking-wide text-slate-500">SQL Server · {status}</span>
      </div>
      <Tabs items={tabs} />
    </div>
  );
}
