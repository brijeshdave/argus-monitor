/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Reports: build an analytics report (type + scope + rolling-or-custom date range),
 * preview it as charts + a table, and export to PDF (with charts), Excel/CSV or
 * JSON. Optionally save a snapshot to the server to re-open or share later. Charts
 * make it presentation-ready for management; the table + CSV serve deeper analysis.
 * Generation is gated behind `reports:generate`.
 */
import { useState, type FormEvent } from "react";
import { REPORT_TYPES, REPORT_TYPE_LABELS, type ReportRequest, type ReportType } from "@argus/shared";
import { useReports, type ReportDoc } from "@/hooks/useReports";
import { useAuth } from "@/auth/AuthContext";
import { Spinner } from "@/components/Spinner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ReportCharts, REPORT_CHARTS_ID } from "@/components/ReportCharts";
import { exportCsv, exportHtml, exportJson, printReport, toTable } from "@/lib/reportExport";

type ScopeKind = ReportRequest["scope"]["kind"];

/** Quick window presets; "custom" reveals two date inputs, "month" = month-to-date. */
const RANGES = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "Last 12 months", days: 365 },
  { key: "month", label: "Month to date" },
  { key: "custom", label: "Custom range…" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";
const labelClass = "mb-1 block text-xs uppercase tracking-wide text-slate-500";

export function ReportsPage() {
  const { has } = useAuth();
  const { loading, error, reports, agents, monitors, reload, generate, preview, open, download, remove } = useReports();

  const canGenerate = has("reports:generate");

  const [type, setType] = useState<ReportType>("summary");
  const [scopeKind, setScopeKind] = useState<ScopeKind>("all");
  const [refId, setRefId] = useState<string>("");
  const [range, setRange] = useState<RangeKey>("30");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  /** Translate the chosen range into the request's window fields. */
  function windowFields(): Pick<ReportRequest, "days" | "from" | "to"> {
    if (range === "custom") return { from: customFrom, to: customTo || undefined };
    if (range === "month") {
      const d = new Date();
      return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01` };
    }
    const r = RANGES.find((x) => x.key === range);
    return { days: "days" in r! ? (r as { days: number }).days : 30 };
  }

  const currentScope = (): ReportRequest["scope"] =>
    scopeKind === "all" ? { kind: "all" } : { kind: scopeKind, refId };

  const currentRequest = (): ReportRequest => ({ type, scope: currentScope(), ...windowFields() });

  async function onPreview() {
    setActionError(null);
    setBusy(true);
    try {
      setDoc(await preview(currentRequest()));
    } catch {
      setActionError("Failed to build report. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    setBusy(true);
    try {
      await generate(currentRequest());
    } catch {
      setActionError("Failed to save report. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onOpen(name: string) {
    setActionError(null);
    setBusy(true);
    try {
      const opened = await open(name);
      setDoc(opened);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setActionError("Failed to open report.");
    } finally {
      setBusy(false);
    }
  }

  async function onDownload(name: string) {
    setActionError(null);
    try {
      await download(name);
    } catch {
      setActionError("Download failed. Please try again.");
    }
  }

  async function onDelete(name: string) {
    setActionError(null);
    try {
      await remove(name);
    } catch {
      setActionError("Delete failed. Please try again.");
    } finally {
      setConfirmDelete(null);
    }
  }

  const needsRef = scopeKind === "agent" || scopeKind === "monitor";
  const refOptions = scopeKind === "agent" ? agents : monitors;
  const refMissing = needsRef && !refId;
  const rangeMissing = range === "custom" && !customFrom;
  const blocked = busy || refMissing || rangeMissing;

  if (loading) return <Spinner label="Loading reports…" />;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Reports & analytics</h1>
        <p className="mt-1 text-sm text-slate-500">
          Build a report, preview it as charts, then export to PDF/CSV — or save a snapshot to revisit later.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      ) : null}
      {actionError ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{actionError}</div>
      ) : null}

      {/* Generate form */}
      {canGenerate ? (
        <section className="space-y-3">
          <form onSubmit={onSave} className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div>
              <label htmlFor="report-type" className={labelClass}>Report</label>
              <select id="report-type" value={type} onChange={(e) => setType(e.target.value as ReportType)} className={`${inputClass} w-52`}>
                {REPORT_TYPES.map((t) => (
                  <option key={t} value={t}>{REPORT_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="report-scope" className={labelClass}>Scope</label>
              <select id="report-scope" value={scopeKind} onChange={(e) => { setScopeKind(e.target.value as ScopeKind); setRefId(""); }} className={`${inputClass} w-40`}>
                <option value="all">All</option>
                <option value="agent">Agent</option>
                <option value="monitor">Monitor</option>
              </select>
            </div>

            {needsRef ? (
              <div>
                <label htmlFor="report-ref" className={labelClass}>{scopeKind === "agent" ? "Agent" : "Monitor"}</label>
                <select id="report-ref" value={refId} onChange={(e) => setRefId(e.target.value)} className={`${inputClass} w-56`}>
                  <option value="">Select…</option>
                  {refOptions.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
                </select>
              </div>
            ) : null}

            <div>
              <label htmlFor="report-range" className={labelClass}>Date range</label>
              <select id="report-range" value={range} onChange={(e) => setRange(e.target.value as RangeKey)} className={`${inputClass} w-44`}>
                {RANGES.map((r) => (<option key={r.key} value={r.key}>{r.label}</option>))}
              </select>
            </div>

            {range === "custom" ? (
              <>
                <div>
                  <label htmlFor="report-from" className={labelClass}>From</label>
                  <input id="report-from" type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} className={`${inputClass} w-40`} />
                </div>
                <div>
                  <label htmlFor="report-to" className={labelClass}>To</label>
                  <input id="report-to" type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} className={`${inputClass} w-40`} />
                </div>
              </>
            ) : null}

            <button type="button" onClick={() => void onPreview()} disabled={blocked}
              className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? "Working…" : "Generate preview"}
            </button>
            <button type="submit" disabled={blocked} title="Freeze this report as a snapshot on the server"
              className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? "Working…" : "Save snapshot"}
            </button>
          </form>
        </section>
      ) : null}

      {/* Preview: charts + export + table */}
      {doc ? (() => {
        const t = toTable(doc);
        return (
          <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">{t.title}</h2>
                <p className="text-xs text-slate-500">{t.subtitle}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => printReport(doc, REPORT_CHARTS_ID)} className="rounded-md bg-sky-500 px-2.5 py-1 text-xs font-medium text-slate-950 hover:bg-sky-400">PDF (with charts)</button>
                <button type="button" onClick={() => exportHtml(doc, REPORT_CHARTS_ID)} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500">HTML</button>
                <button type="button" onClick={() => exportCsv(doc)} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500">Excel / CSV</button>
                <button type="button" onClick={() => exportJson(doc)} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500">JSON</button>
              </div>
            </div>

            <ReportCharts doc={doc} />

            <details className="rounded-md border border-slate-800">
              <summary className="cursor-pointer px-4 py-2 text-xs uppercase tracking-wide text-slate-400">Data table ({t.rows.length} rows)</summary>
              <div className="max-h-96 overflow-auto border-t border-slate-800">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 border-b border-slate-800 bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                    <tr>{t.columns.map((c) => <th key={c} className="px-4 py-2 font-medium">{c}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {t.rows.length === 0 ? (
                      <tr><td colSpan={t.columns.length} className="px-4 py-6 text-slate-500">No data in this window.</td></tr>
                    ) : (
                      t.rows.map((r, i) => (
                        <tr key={i} className="text-slate-200">{r.map((c, j) => <td key={j} className="px-4 py-2 tabular-nums">{c}</td>)}</tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        );
      })() : null}

      {/* Saved snapshots */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-100">Saved snapshots</h2>
          <button type="button" onClick={reload} className="text-xs text-slate-500 underline transition-colors hover:text-slate-300">Refresh</button>
        </div>
        <p className="text-xs text-slate-500">
          Snapshots freeze a report's data for its window so you can re-open it (re-render charts, re-export), or share the raw JSON —
          handy for month-end records and audits. Day-to-day analysis doesn't need saving; just <span className="text-slate-300">Generate preview</span> and export.
        </p>

        <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Report</th>
                <th className="px-4 py-3 font-medium">Scope · window</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Size</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {reports.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-slate-500">No saved snapshots yet.</td></tr>
              ) : (
                reports.map((r) => (
                  <tr key={r.name} className="text-slate-200">
                    <td className="px-4 py-3">{REPORT_TYPE_LABELS[r.type] ?? r.type}</td>
                    <td className="px-4 py-3 text-slate-400">{[r.scopeLabel, r.windowLabel].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-4 py-3 text-slate-400">{formatWhen(r.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-400">{formatSize(r.size)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => void onOpen(r.name)} className="rounded-md border border-sky-600/50 px-2.5 py-1 text-xs text-sky-300 transition-colors hover:bg-sky-500/10">Open</button>
                        <button type="button" onClick={() => onDownload(r.name)} className="rounded-md border border-slate-600/60 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-700/30">JSON</button>
                        {canGenerate ? (
                          <button type="button" onClick={() => setConfirmDelete(r.name)} className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 transition-colors hover:bg-rose-500/10">Delete</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete snapshot"
          message={<>Delete this saved report snapshot? This cannot be undone.</>}
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => onDelete(confirmDelete)}
        />
      ) : null}
    </div>
  );
}
