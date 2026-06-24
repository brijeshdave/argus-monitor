/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Uptime explorer: pick a host + monitor and a look-back window (no raw ids), see
 * the overall uptime % and a per-bucket availability chart. Buckets key on
 * sourceId=agentId and entity=monitor.name (the diff pipeline's convention).
 */
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AgentDTO, MonitorDTO } from "@argus/shared";
import { api } from "@/lib/api";
import { useUptime } from "@/hooks/useTelemetry";
import { Spinner } from "@/components/Spinner";

const selectCls =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";

const WINDOWS: Array<{ label: string; hours: number }> = [
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
  { label: "90 days", hours: 24 * 90 },
];

export function UptimePage() {
  const { loading, error, rows, overallPct, fetchUptime } = useUptime();
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [monitors, setMonitors] = useState<MonitorDTO[]>([]);
  const [agentId, setAgentId] = useState("");
  const [monitorName, setMonitorName] = useState(""); // entity = monitor name; "" = whole host
  const [hours, setHours] = useState(24 * 7);

  // Load hosts + monitors for the pickers.
  useEffect(() => {
    void (async () => {
      const [a, m] = await Promise.all([
        api.get<{ rows: AgentDTO[] }>("/api/agents"),
        api.get<{ rows: MonitorDTO[] }>("/api/monitors"),
      ]);
      setAgents(a.rows);
      setMonitors(m.rows);
      if (a.rows[0]) setAgentId(a.rows[0].id);
    })();
  }, []);

  const hostMonitors = useMemo(() => monitors.filter((m) => m.agentId === agentId), [monitors, agentId]);

  // Fetch whenever the selection or window changes.
  useEffect(() => {
    if (agentId) fetchUptime(agentId, monitorName, hours);
  }, [agentId, monitorName, hours, fetchUptime]);

  const data = useMemo(
    () => rows.map((r) => ({ label: new Date(r.bucketStart).toLocaleString(), pct: r.totalSec > 0 ? Number(((r.upSec / r.totalSec) * 100).toFixed(2)) : 0 })),
    [rows],
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-100">Uptime</h1>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Host</label>
          <select value={agentId} onChange={(e) => { setAgentId(e.target.value); setMonitorName(""); }} className={selectCls}>
            {agents.length === 0 ? <option value="">No hosts</option> : null}
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Monitor</label>
          <select value={monitorName} onChange={(e) => setMonitorName(e.target.value)} className={selectCls}>
            <option value="">All monitors on host</option>
            {hostMonitors.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Window</label>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={selectCls}>
            {WINDOWS.map((w) => <option key={w.hours} value={w.hours}>{w.label}</option>)}
          </select>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      ) : null}

      {loading ? (
        <Spinner label="Loading uptime…" />
      ) : !agentId ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-6 text-sm text-slate-500">Select a host to view uptime.</div>
      ) : (
        <>
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Overall uptime · {monitorName || "all monitors"} · {WINDOWS.find((w) => w.hours === hours)?.label}
            </div>
            <div className="mt-1 text-4xl font-semibold text-status-up">
              {overallPct === null ? "—" : `${overallPct.toFixed(2)}%`}
            </div>
          </div>

          <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            {data.length === 0 ? (
              <div className="py-6 text-sm text-slate-500">No uptime data recorded in this window yet.</div>
            ) : (
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#232c38" />
                    <XAxis dataKey="label" tick={{ fill: "#8a9cb0", fontSize: 11 }} hide />
                    <YAxis domain={[0, 100]} tick={{ fill: "#8a9cb0", fontSize: 11 }} unit="%" width={44} />
                    <Tooltip contentStyle={{ background: "#12161c", border: "1px solid #232c38", borderRadius: 8, color: "#eef3f9" }} formatter={(v: number) => [`${v}%`, "Uptime"]} />
                    <Bar dataKey="pct" fill="#22c55e" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
