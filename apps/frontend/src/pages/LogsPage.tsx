/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Logs viewer: filter by category, level, source (host), date range and free text;
 * sort newest/oldest. Source ids are resolved to host names server-side. Read-only
 * — the event log is the system of record.
 */
import { useEffect, useState } from "react";
import { usePagedList, useAgentOptions, type TelemetryRow } from "@/hooks/useTelemetry";
import { Spinner } from "@/components/Spinner";
import { CategoryBadge, LevelBadge } from "@/components/Badge";
import { FilterDrawer } from "@/components/FilterDrawer";
import { Pager } from "@/components/Pager";

const inputCls =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function str(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return typeof value === "string" ? value : String(value);
}

function formatTs(value: unknown): string {
  if (typeof value !== "string") return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

const ts = (r: TelemetryRow): string => formatTs(r.ts ?? r.createdAt ?? r.timestamp);

export function LogsPage() {
  const agents = useAgentOptions();
  const [category, setCategory] = useState("");
  const [level, setLevel] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("desc");

  const list = usePagedList("/api/logs", { category, level, sourceId, from, to, q, sort });
  const appliedCount = [category, level, sourceId, from, to, q].filter(Boolean).length + (sort !== "desc" ? 1 : 0);
  const reset = () => { setCategory(""); setLevel(""); setSourceId(""); setFrom(""); setTo(""); setQ(""); setSort("desc"); };

  // Live auto-refresh: re-fetch on an interval (0 = off). "Live" polls fast (3s) for
  // active debugging; longer intervals reduce load. Pauses while off.
  const [autoSec, setAutoSec] = useState(0);
  const { reload } = list;
  useEffect(() => {
    if (autoSec <= 0) return;
    const t = setInterval(() => reload(), autoSec * 1000);
    return () => clearInterval(t);
  }, [autoSec, reload]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-100">Logs</h1>
        <div className="flex items-center gap-2">
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search message…" className="w-56 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500" />
          <label className="flex items-center gap-1.5 text-xs text-slate-400" title="Auto-refresh the log view (for live debugging)">
            <span className={autoSec > 0 ? "text-emerald-300" : ""}>{autoSec > 0 ? "Live" : "Auto"}</span>
            <select value={autoSec} onChange={(e) => setAutoSec(Number(e.target.value))} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100 outline-none focus:border-sky-500">
              <option value={0}>Off</option>
              <option value={3}>Live (3s)</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={20}>20s</option>
              <option value={30}>30s</option>
            </select>
          </label>
          <FilterDrawer appliedCount={appliedCount} onReset={reset}>
            <Field label="Source host">
              <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={inputCls}>
                <option value="">All sources</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Level">
              <select value={level} onChange={(e) => setLevel(e.target.value)} className={inputCls}>
                <option value="">All levels</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
            </Field>
            <Field label="Category">
              <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. agent" className={inputCls} />
            </Field>
            <Field label="From"><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></Field>
            <Field label="To"><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputCls} /></Field>
            <Field label="Sort">
              <select value={sort} onChange={(e) => setSort(e.target.value)} className={inputCls}>
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
            </Field>
          </FilterDrawer>
        </div>
      </div>

      {list.error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{list.error}</div> : null}

      {list.loading ? (
        <Spinner label="Loading logs…" />
      ) : (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Level</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {list.rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-slate-500">No logs match the current filters.</td></tr>
              ) : (
                list.rows.map((r, i) => (
                  <tr key={str(r.id) + i} className="text-slate-200">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-400">{ts(r)}</td>
                    <td className="px-4 py-3"><LevelBadge level={str(r.level)} /></td>
                    <td className="px-4 py-3"><CategoryBadge value={str(r.category)} /></td>
                    <td className="px-4 py-3 text-slate-400">{r.sourceName ? str(r.sourceName) : (r.sourceId ? str(r.sourceId) : "—")}</td>
                    <td className="px-4 py-3">{str(r.message)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <Pager list={list} />
        </section>
      )}
    </div>
  );
}
