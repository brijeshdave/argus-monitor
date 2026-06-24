/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Host CPU% + RAM% history chart for an agent, with the standard period presets.
 * Reads /api/agents/:id/metrics (host_metrics points).
 */
import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { PeriodSelector } from "@/components/PeriodSelector";

interface MetricPoint { ts: string; cpuPct: number | null; memPct: number | null; memUsedMb: number | null }

export function HostMetricsChart({ agentId }: { agentId: string }) {
  const [points, setPoints] = useState<MetricPoint[]>([]);
  const [period, setPeriod] = useState("hours=24");
  useEffect(() => {
    let cancelled = false;
    const load = () => api.get<{ points: MetricPoint[] }>(`/api/agents/${agentId}/metrics?${period}`).then(
      (r) => { if (!cancelled) setPoints(r.points); }, () => {},
    );
    void load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [agentId, period]);

  const data = points.map((p) => ({ t: new Date(p.ts).getTime(), cpu: p.cpuPct ?? null, ram: p.memPct ?? null }));

  return (
    <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-100">CPU &amp; memory</h2>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>
      {data.length < 2 ? (
        <div className="py-10 text-center text-sm text-slate-500">Not enough metrics in this window yet.</div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
              <defs>
                <linearGradient id="cpuG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5} /><stop offset="100%" stopColor="#38bdf8" stopOpacity={0.05} /></linearGradient>
                <linearGradient id="ramG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" stopOpacity={0.5} /><stop offset="100%" stopColor="#a78bfa" stopOpacity={0.05} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#232c38" vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={(t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" })} tick={{ fill: "#8a9cb0", fontSize: 10 }} minTickGap={48} />
              <YAxis domain={[0, 100]} unit="%" tick={{ fill: "#8a9cb0", fontSize: 11 }} width={40} />
              <Tooltip contentStyle={{ background: "#12161c", border: "1px solid #232c38", borderRadius: 8, color: "#eef3f9", fontSize: 12 }} labelFormatter={(t) => new Date(Number(t)).toLocaleString()} formatter={(v: number, n) => [v == null ? "—" : `${v.toFixed(1)}%`, n === "cpu" ? "CPU" : "RAM"]} />
              <Area type="monotone" dataKey="cpu" name="cpu" stroke="#38bdf8" fill="url(#cpuG)" strokeWidth={1.5} connectNulls />
              <Area type="monotone" dataKey="ram" name="ram" stroke="#a78bfa" fill="url(#ramG)" strokeWidth={1.5} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="flex gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-sky-400" />CPU %</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-violet-400" />RAM %</span>
      </div>
    </section>
  );
}
