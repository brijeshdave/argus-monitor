/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Audit log viewer: filter by category, action, date range and free text; sort
 * newest/oldest. Actor and target ids are resolved to names server-side. Each row
 * expands to show exactly what changed (a field-level before→after diff).
 */
import { Fragment, useState } from "react";
import { usePagedList, type TelemetryRow } from "@/hooks/useTelemetry";
import { Spinner } from "@/components/Spinner";
import { CategoryBadge } from "@/components/Badge";
import { FilterDrawer } from "@/components/FilterDrawer";
import { Pager } from "@/components/Pager";

const inputCls =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";

const CATEGORIES = ["agents", "monitors", "wallboards", "devices", "public", "auth", "retention", "reports", "settings"];

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

/** Render a value compactly for the diff cells. */
function val(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

type Obj = Record<string, unknown>;

/** Field-level changes between two snapshots (union of keys; differing values). */
function diff(before: Obj | null, after: Obj | null): Array<{ key: string; before: unknown; after: unknown }> {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: Array<{ key: string; before: unknown; after: unknown }> = [];
  for (const key of [...keys].sort()) {
    const b = before?.[key];
    const a = after?.[key];
    if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ key, before: b, after: a });
  }
  return out;
}

function asObj(v: unknown): Obj | null {
  return v && typeof v === "object" ? (v as Obj) : null;
}

function ChangeDetail({ row }: { row: TelemetryRow }) {
  const before = asObj(row.before);
  const after = asObj(row.after);
  if (!before && !after) {
    return <div className="px-4 py-3 text-xs text-slate-500">No field-level detail was captured for this action.</div>;
  }
  const changes = diff(before, after);
  const verb = !before ? "Created" : !after ? "Deleted" : "Updated";
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{verb} — {changes.length} field{changes.length === 1 ? "" : "s"} changed</div>
      {changes.length === 0 ? (
        <div className="text-xs text-slate-500">No differing fields.</div>
      ) : (
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr><th className="py-1 pr-4 font-medium">Field</th><th className="py-1 pr-4 font-medium">Before</th><th className="py-1 font-medium">After</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {changes.map((c) => (
              <tr key={c.key} className="align-top">
                <td className="py-1.5 pr-4 font-mono text-slate-300">{c.key}</td>
                <td className="py-1.5 pr-4 font-mono text-rose-300/80 break-all">{val(c.before)}</td>
                <td className="py-1.5 font-mono text-emerald-300/80 break-all">{val(c.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function AuditPage() {
  const [category, setCategory] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("desc");
  const [open, setOpen] = useState<string | null>(null);

  const list = usePagedList("/api/audit", { category, action, from, to, q, sort });
  const appliedCount = [category, action, from, to, q].filter(Boolean).length + (sort !== "desc" ? 1 : 0);
  const reset = () => { setCategory(""); setAction(""); setFrom(""); setTo(""); setQ(""); setSort("desc"); };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-100">Audit log</h1>
        <div className="flex items-center gap-2">
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search action / target…" className="w-60 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500" />
          <FilterDrawer appliedCount={appliedCount} onReset={reset}>
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                <option value="">All categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Action">
              <input type="text" value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. monitor.update" className={inputCls} />
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
        <Spinner label="Loading audit log…" />
      ) : (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">IP</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {list.rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-slate-500">No audit entries match the current filters.</td></tr>
              ) : (
                list.rows.map((r, i) => {
                  const id = str(r.id) + i;
                  const isOpen = open === id;
                  const target = r.targetName ? str(r.targetName) : str(r.target);
                  return (
                    <Fragment key={id}>
                      <tr className="cursor-pointer text-slate-200 hover:bg-slate-800/30" onClick={() => setOpen(isOpen ? null : id)}>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-400">{ts(r)}</td>
                        <td className="px-4 py-3">
                          {r.actorName ? str(r.actorName) : str(r.actor ?? r.actorId ?? "system")}
                          {r.actorRole ? <span className="ml-1 text-xs text-slate-500">({str(r.actorRole)})</span> : null}
                        </td>
                        <td className="px-4 py-3"><CategoryBadge value={str(r.action)} /></td>
                        <td className="px-4 py-3"><CategoryBadge value={str(r.category)} /></td>
                        <td className="px-4 py-3 text-slate-400">
                          {target}{r.targetKind ? <span className="ml-1 text-xs text-slate-500">{str(r.targetKind)}</span> : null}
                        </td>
                        <td className="px-4 py-3 text-slate-400">{str(r.ip ?? r.ipAddress)}</td>
                        <td className="px-4 py-3 text-right text-xs text-slate-500">{isOpen ? "▲" : "▼"}</td>
                      </tr>
                      {isOpen ? (
                        <tr className="bg-slate-950/40">
                          <td colSpan={7} className="border-t border-slate-800/60 p-0"><ChangeDetail row={r} /></td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
          <Pager list={list} />
        </section>
      )}
    </div>
  );
}
