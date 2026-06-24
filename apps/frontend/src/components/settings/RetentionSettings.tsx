/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Data-retention settings tab. Per-data-type pruning windows (days; blank = keep
 * forever) for every telemetry kind — monitor metrics (host/process/ping/SNMP/DB/
 * storage/folders), events, logs, audit, notifications, uptime. Saved per row; a
 * "Run cleanup now" button triggers an immediate sweep. Uses its own endpoints
 * (/api/retention) + permissions (retention:read / retention:write).
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/auth/AuthContext";

interface RetentionRow {
  dataType: string;
  days: number | null;
}

const LABELS: Record<string, { label: string; group: string }> = {
  host_metrics: { label: "Host metrics (CPU / RAM)", group: "Monitor metrics" },
  process_metrics: { label: "Process CPU / RAM history", group: "Monitor metrics" },
  ping_samples: { label: "Ping / latency samples", group: "Monitor metrics" },
  snmp_metrics: { label: "SNMP metrics", group: "Monitor metrics" },
  db_metrics: { label: "Database metrics", group: "Monitor metrics" },
  storage_metrics: { label: "Storage capacity", group: "Monitor metrics" },
  folder_metrics: { label: "Folder snapshots (size / counts)", group: "Monitor metrics" },
  status_events: { label: "Status change events", group: "Events" },
  client_events: { label: "Client connect / disconnect", group: "Events" },
  notifications: { label: "Notifications", group: "Events" },
  uptime_buckets: { label: "Uptime history", group: "Events" },
  logs: { label: "Logs", group: "Logs & audit" },
  audit_log: { label: "Audit log", group: "Logs & audit" },
};
const GROUP_ORDER = ["Monitor metrics", "Events", "Logs & audit"];

export function RetentionSettings() {
  const { has } = useAuth();
  const canRead = has("retention:read");
  const canWrite = has("retention:write");
  const [rows, setRows] = useState<RetentionRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingType, setSavingType] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    api.get<{ rows: RetentionRow[] }>("/api/retention").then((r) => {
      setRows(r.rows);
      setDraft(Object.fromEntries(r.rows.map((x) => [x.dataType, x.days == null ? "" : String(x.days)])));
    }, () => {});
  useEffect(() => {
    if (canRead) void load();
  }, [canRead]);

  const save = async (dataType: string) => {
    const raw = (draft[dataType] ?? "").trim();
    const days = raw === "" ? null : Math.max(0, Math.floor(Number(raw)));
    if (raw !== "" && !Number.isFinite(days)) return;
    setSavingType(dataType);
    try {
      await api.put(`/api/retention/${dataType}`, { days });
      setMsg(`Saved ${LABELS[dataType]?.label ?? dataType}`);
      await load();
    } catch {
      setMsg("Save failed");
    } finally {
      setSavingType(null);
      setTimeout(() => setMsg(null), 2500);
    }
  };

  const runNow = async () => {
    setMsg("Running cleanup…");
    try {
      const r = await api.post<{ pruned: Record<string, string> }>("/api/retention/run", {});
      setMsg(`Cleanup done — pruned ${Object.keys(r.pruned).length} data type(s)`);
    } catch {
      setMsg("Cleanup failed");
    } finally {
      setTimeout(() => setMsg(null), 4000);
    }
  };

  if (!canRead) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
        You do not have permission to view data retention.
      </div>
    );
  }

  const byType = new Map(rows.map((r) => [r.dataType, r]));
  const dirty = (t: string) => (draft[t] ?? "") !== (byType.get(t)?.days == null ? "" : String(byType.get(t)!.days));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-400">
          How long each kind of data is kept. Blank = keep forever. A daily job prunes anything older than its window.
        </p>
        {canWrite ? (
          <button type="button" onClick={runNow} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-500">
            Run cleanup now
          </button>
        ) : null}
      </header>

      {msg ? <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">{msg}</div> : null}

      {GROUP_ORDER.map((group) => {
        const types = Object.entries(LABELS).filter(([, v]) => v.group === group).map(([t]) => t).filter((t) => byType.has(t));
        if (!types.length) return null;
        return (
          <section key={group} className="rounded-lg border border-slate-800 bg-slate-900/40">
            <h3 className="border-b border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{group}</h3>
            <div className="divide-y divide-slate-800/60">
              {types.map((t) => (
                <div key={t} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1 text-slate-200">{LABELS[t]!.label}</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      placeholder="∞"
                      disabled={!canWrite}
                      value={draft[t] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [t]: e.target.value }))}
                      className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-right text-slate-100 outline-none focus:border-sky-500 disabled:opacity-50"
                    />
                    <span className="w-10 text-xs text-slate-500">days</span>
                  </div>
                  {canWrite ? (
                    <button
                      type="button"
                      disabled={!dirty(t) || savingType === t}
                      onClick={() => save(t)}
                      className="rounded-md bg-sky-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-600 disabled:opacity-40"
                    >
                      {savingType === t ? "…" : "Save"}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <p className="text-xs text-slate-500">
        Tip: keep capacity/uptime/SNMP long (years) for trends; trim high-volume host &amp; process metrics, ping samples and logs shorter to save space. Folder snapshots are written at most hourly per monitor.
      </p>
    </div>
  );
}
