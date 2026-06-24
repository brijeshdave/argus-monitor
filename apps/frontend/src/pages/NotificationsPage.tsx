/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Notifications viewer: filter by severity, source (host), acknowledged state,
 * date range and free text; sort newest/oldest. Source ids are resolved to host
 * names server-side. Permission-gated Acknowledge action.
 */
import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import { usePagedList, useAgentOptions, type TelemetryRow } from "@/hooks/useTelemetry";
import { useAuth } from "@/auth/AuthContext";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { Pager } from "@/components/Pager";

const inputCls =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";

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
const isAcked = (r: TelemetryRow): boolean => Boolean(r.acknowledged ?? r.ackedAt);

export function NotificationsPage() {
  const { has } = useAuth();
  const canAck = has("notifications:ack");
  const agents = useAgentOptions();

  const [severity, setSeverity] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [acknowledged, setAcknowledged] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("desc");

  const list = usePagedList("/api/notifications", { severity, sourceId, acknowledged, from, to, q, sort });
  const reset = () => { setSeverity(""); setSourceId(""); setAcknowledged(""); setFrom(""); setTo(""); setQ(""); setSort("desc"); };

  const [actionError, setActionError] = useState<string | null>(null);
  const acknowledge = useCallback(
    async (id: string) => {
      setActionError(null);
      try {
        await api.patch(`/api/notifications/${id}/ack`);
        list.reload();
      } catch {
        setActionError("Failed to acknowledge notification.");
      }
    },
    [list],
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-100">Notifications</h1>

      <div className="flex flex-wrap items-end gap-3">
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={inputCls} title="Severity">
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={inputCls} title="Source host">
          <option value="">All sources</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={acknowledged} onChange={(e) => setAcknowledged(e.target.value)} className={inputCls} title="Acknowledged state">
          <option value="">All</option>
          <option value="false">Unacknowledged</option>
          <option value="true">Acknowledged</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-500">From<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></label>
        <label className="flex items-center gap-1 text-xs text-slate-500">To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputCls} /></label>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search text…" className={inputCls} />
        <select value={sort} onChange={(e) => setSort(e.target.value)} className={inputCls} title="Sort order">
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>
        <button type="button" onClick={reset} className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500">Reset</button>
      </div>

      {list.error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{list.error}</div> : null}
      {actionError ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{actionError}</div> : null}

      {list.loading ? (
        <Spinner label="Loading notifications…" />
      ) : (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
          <ul className="divide-y divide-slate-800">
            {list.rows.length === 0 ? (
              <li className="px-4 py-6 text-sm text-slate-500">No notifications match the current filters.</li>
            ) : (
              list.rows.map((r, i) => {
                const acked = isAcked(r);
                return (
                  <li key={str(r.id) + i} className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={str(r.severity)} />
                        <span className="font-medium text-slate-100">{str(r.title)}</span>
                      </div>
                      <p className="text-sm text-slate-300">{str(r.plainLanguage ?? r.message ?? r.body)}</p>
                      <span className="text-xs text-slate-500">
                        {ts(r)}{r.sourceName ? <> · <span className="text-slate-400">{str(r.sourceName)}</span></> : null}
                      </span>
                    </div>
                    {canAck && !acked ? (
                      <button type="button" onClick={() => void acknowledge(str(r.id))} className="rounded-md border border-emerald-600/50 px-2.5 py-1 text-xs text-emerald-300 transition-colors hover:bg-emerald-500/10">
                        Acknowledge
                      </button>
                    ) : acked ? (
                      <span className="text-xs uppercase tracking-wide text-emerald-400/70">Acknowledged</span>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
          <Pager list={list} />
        </section>
      )}
    </div>
  );
}
