/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Backups admin, organised into three tabs:
 *   • Backups   — run a backup of a chosen SCOPE (config / data / both); a sortable,
 *                 paginated, scope-filtered table to download / restore / delete; and
 *                 a "Prune now" action that applies the retention policy.
 *   • Schedules — MANY automatic schedules (e.g. config-only daily + data-only weekly),
 *                 each with its own scope + cadence; add / edit / remove.
 *   • Retention — global policy for managing copies: keep last-N per scope plus GFS
 *                 daily / weekly / monthly tiers.
 * Restore is DESTRUCTIVE (within the bundle's scope) and gated behind `backups:restore`.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BACKUP_FREQUENCIES,
  BACKUP_SCOPES,
  backupScopeLabel,
  describeBackupSchedule,
  newBackupSchedule,
  type BackupRetention,
  type BackupScope,
} from "@argus/shared";
import { useBackups, type BackupSchedule } from "@/hooks/useBackups";
import { useAuth } from "@/auth/AuthContext";
import { useConfirm } from "@/components/ConfirmProvider";
import { useClientPager } from "@/hooks/useClientPager";
import { Spinner } from "@/components/Spinner";
import { SortHeader, useSort } from "@/components/SortHeader";
import { Pager } from "@/components/Pager";
import { Tabs } from "@/components/Tabs";

type BackupSortKey = "name" | "scope" | "size" | "createdAt";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const inputCls = "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";
const fieldCls = "mb-1 block text-xs uppercase tracking-wide text-slate-500";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const scopeBadge: Record<BackupScope, string> = {
  all: "bg-sky-500/15 text-sky-300",
  config: "bg-violet-500/15 text-violet-300",
  data: "bg-emerald-500/15 text-emerald-300",
};

export function BackupsPage() {
  const { has } = useAuth();
  const confirm = useConfirm();
  const { loading, error, backups, schedules, retention, reload, runBackup, restore, remove, prune, download, saveSchedules, saveRetention } = useBackups();

  const canRun = has("backups:run");
  const canRestore = has("backups:restore");

  const [actionError, setActionError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runScope, setRunScope] = useState<BackupScope>("all");

  // Table: filter by scope, sort, paginate.
  const [fScope, setFScope] = useState("");
  const { sorted, sort } = useSort<(typeof backups)[number], BackupSortKey>(backups, (b, key) => b[key], { key: "createdAt", dir: "desc" });
  const filtered = useMemo(() => sorted.filter((b) => (fScope ? b.scope === fScope : true)), [sorted, fScope]);
  const pager = useClientPager(filtered, 25);

  // Editable copies of schedules + retention (saved explicitly).
  const [schedDraft, setSchedDraft] = useState<BackupSchedule[]>([]);
  const [retDraft, setRetDraft] = useState<BackupRetention | null>(null);
  useEffect(() => setSchedDraft(schedules), [schedules]);
  useEffect(() => setRetDraft(retention), [retention]);

  async function run(fn: () => Promise<void>, ok?: string) {
    setActionError(null);
    setNote(null);
    setBusy(true);
    try {
      await fn();
      if (ok) setNote(ok);
    } catch {
      setActionError("Action failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function onRestore(name: string, scope: BackupScope) {
    void (async () => {
      const what = scope === "config" ? "all configuration" : scope === "data" ? "all telemetry data" : "ALL data in both databases";
      const ok = await confirm({
        title: "Restore backup",
        message: (
          <>
            Restore <span className="font-medium text-slate-100">{name}</span>? This{" "}
            <span className="font-semibold text-rose-300">overwrites {what}</span> and cannot be undone.
          </>
        ),
        confirmLabel: "Restore & overwrite",
      });
      if (ok) await run(() => restore(name), "Restore complete.");
    })();
  }

  function onDelete(name: string) {
    void (async () => {
      const ok = await confirm({
        title: "Delete backup",
        message: <>Delete <span className="font-medium text-slate-100">{name}</span>? This removes the file permanently.</>,
        confirmLabel: "Delete",
      });
      if (ok) await run(() => remove(name), "Backup deleted.");
    })();
  }

  function onPrune() {
    void (async () => {
      const ok = await confirm({
        title: "Prune backups",
        message: "Apply the retention policy now? Backups not protected by any rule (last-N per scope, or a daily/weekly/monthly tier) are deleted.",
        confirmLabel: "Prune now",
      });
      if (ok) await run(async () => { const n = await prune(); setNote(`Pruned ${n} backup${n === 1 ? "" : "s"}.`); });
    })();
  }

  if (loading) return <Spinner label="Loading backups…" />;

  // ── Tab: Backups ─────────────────────────────────────────────────────────
  const backupsNode = (
    <div className="space-y-5">
      {canRun ? (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div>
            <label htmlFor="runScope" className={fieldCls}>Back up</label>
            <select id="runScope" value={runScope} onChange={(e) => setRunScope(e.target.value as BackupScope)} className={inputCls}>
              {BACKUP_SCOPES.map((s) => <option key={s} value={s}>{backupScopeLabel(s)}</option>)}
            </select>
          </div>
          <button type="button" disabled={busy} onClick={() => run(() => runBackup(runScope), "Backup created.")} className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">
            {busy ? "Working…" : "Back up now"}
          </button>
          <button type="button" disabled={busy} onClick={onPrune} className="rounded-md border border-slate-600 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60">
            Prune now
          </button>
          <span className="self-center text-xs text-slate-500">
            <b>Config</b> = identity/RBAC/settings/secrets · <b>Data</b> = metrics/events/logs/audit · <b>Both</b> = full snapshot.
          </span>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">{filtered.length} of {backups.length} backup{backups.length === 1 ? "" : "s"}</span>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Scope
          <select value={fScope} onChange={(e) => setFScope(e.target.value)} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500">
            <option value="">All</option>
            {BACKUP_SCOPES.map((s) => <option key={s} value={s}>{backupScopeLabel(s)}</option>)}
          </select>
        </label>
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortHeader label="Name" sortKey="name" sort={sort} />
              <SortHeader label="Scope" sortKey="scope" sort={sort} />
              <SortHeader label="Size" sortKey="size" sort={sort} />
              <SortHeader label="Created" sortKey="createdAt" sort={sort} />
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-slate-500">{backups.length === 0 ? "No backups yet." : "No backups match the filter."}</td></tr>
            ) : (
              pager.pageRows.map((b) => (
                <tr key={b.name} className="text-slate-200">
                  <td className="px-4 py-3 font-mono text-xs">{b.name}</td>
                  <td className="px-4 py-3"><span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${scopeBadge[b.scope]}`}>{backupScopeLabel(b.scope)}</span></td>
                  <td className="px-4 py-3 text-slate-400">{formatSize(b.size)}</td>
                  <td className="px-4 py-3 text-slate-400">{formatWhen(b.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => run(() => download(b.name))} className="rounded-md border border-slate-600/60 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-700/30">Download</button>
                      {canRestore ? <button type="button" onClick={() => onRestore(b.name, b.scope)} className="rounded-md border border-amber-600/50 px-2.5 py-1 text-xs text-amber-300 transition-colors hover:bg-amber-500/10">Restore</button> : null}
                      {canRun ? <button type="button" onClick={() => onDelete(b.name)} className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 transition-colors hover:bg-rose-500/10">Delete</button> : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {filtered.length > pager.list.limit ? <Pager list={pager.list} /> : null}
      </section>
    </div>
  );

  // ── Tab: Schedules ───────────────────────────────────────────────────────
  const setSched = (id: string, patch: Partial<BackupSchedule>) =>
    setSchedDraft((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const schedulesNode = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">Run different scopes on different cadences — e.g. config-only daily and data-only weekly.</p>
        {canRun ? (
          <button type="button" onClick={() => setSchedDraft((l) => [...l, newBackupSchedule(`sched-${Date.now()}`)])} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:border-slate-400">+ Add schedule</button>
        ) : null}
      </div>

      {schedDraft.length === 0 ? <p className="text-xs text-slate-600">No schedules. Add one to back up automatically.</p> : null}

      <div className="space-y-3">
        {schedDraft.map((s) => (
          <div key={s.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={s.enabled} onChange={(e) => setSched(s.id, { enabled: e.target.checked })} className="h-4 w-4 accent-sky-500" />
                Enabled
              </label>
              <span className="text-xs text-slate-500">{describeBackupSchedule(s)} · {backupScopeLabel(s.scope)}</span>
              {canRun ? <button type="button" onClick={() => setSchedDraft((l) => l.filter((x) => x.id !== s.id))} className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 transition-colors hover:bg-rose-500/10">Remove</button> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <span className={fieldCls}>Name</span>
                <input value={s.name} onChange={(e) => setSched(s.id, { name: e.target.value })} className={`${inputCls} w-full`} />
              </label>
              <label className="block">
                <span className={fieldCls}>Scope</span>
                <select value={s.scope} onChange={(e) => setSched(s.id, { scope: e.target.value as BackupScope })} className={`${inputCls} w-full`}>
                  {BACKUP_SCOPES.map((sc) => <option key={sc} value={sc}>{backupScopeLabel(sc)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={fieldCls}>Frequency</span>
                <select value={s.frequency} onChange={(e) => setSched(s.id, { frequency: e.target.value as BackupSchedule["frequency"] })} className={`${inputCls} w-full`}>
                  {BACKUP_FREQUENCIES.map((fr) => <option key={fr} value={fr}>{fr[0]!.toUpperCase() + fr.slice(1)}</option>)}
                </select>
              </label>
              {s.frequency === "interval" ? (
                <label className="block">
                  <span className={fieldCls}>Every (hours)</span>
                  <input type="number" min={1} value={s.intervalHours} onChange={(e) => setSched(s.id, { intervalHours: Math.max(1, Number(e.target.value)) })} className={`${inputCls} w-full`} />
                </label>
              ) : (
                <label className="block">
                  <span className={fieldCls}>At time</span>
                  <input type="time" value={s.time} onChange={(e) => setSched(s.id, { time: e.target.value })} className={`${inputCls} w-full`} />
                </label>
              )}
              {s.frequency === "weekly" ? (
                <label className="block">
                  <span className={fieldCls}>Day of week</span>
                  <select value={s.weekday} onChange={(e) => setSched(s.id, { weekday: Number(e.target.value) })} className={`${inputCls} w-full`}>
                    {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </label>
              ) : null}
              {s.frequency === "monthly" ? (
                <label className="block">
                  <span className={fieldCls}>Day of month</span>
                  <input type="number" min={1} max={31} value={s.dayOfMonth} onChange={(e) => setSched(s.id, { dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value))) })} className={`${inputCls} w-full`} />
                </label>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {canRun ? (
        <button type="button" disabled={busy} onClick={() => run(() => saveSchedules(schedDraft), "Schedules saved.")} className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">Save schedules</button>
      ) : null}
    </div>
  );

  // ── Tab: Retention ───────────────────────────────────────────────────────
  const retentionNode = retDraft ? (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => saveRetention(retDraft), "Retention policy saved."); }} className="max-w-2xl space-y-5">
      <p className="text-sm text-slate-400">A backup is kept if ANY rule protects it. Rules are evaluated <b>per scope</b>, so config / data / full copies are retained independently. Set a count to 0 to disable that rule.</p>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-200">Keep latest (per scope)</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block"><span className={fieldCls}>Last config</span><input type="number" min={0} value={retDraft.keepConfig} onChange={(e) => setRetDraft({ ...retDraft, keepConfig: Math.max(0, Number(e.target.value)) })} className={`${inputCls} w-full`} /></label>
          <label className="block"><span className={fieldCls}>Last data</span><input type="number" min={0} value={retDraft.keepData} onChange={(e) => setRetDraft({ ...retDraft, keepData: Math.max(0, Number(e.target.value)) })} className={`${inputCls} w-full`} /></label>
          <label className="block"><span className={fieldCls}>Last full</span><input type="number" min={0} value={retDraft.keepAll} onChange={(e) => setRetDraft({ ...retDraft, keepAll: Math.max(0, Number(e.target.value)) })} className={`${inputCls} w-full`} /></label>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-200">Grandfather-father-son tiers (per scope)</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block"><span className={fieldCls}>Daily (keep N days)</span><input type="number" min={0} value={retDraft.daily} onChange={(e) => setRetDraft({ ...retDraft, daily: Math.max(0, Number(e.target.value)) })} className={`${inputCls} w-full`} /></label>
          <label className="block"><span className={fieldCls}>Weekly (keep N weeks)</span><input type="number" min={0} value={retDraft.weekly} onChange={(e) => setRetDraft({ ...retDraft, weekly: Math.max(0, Number(e.target.value)) })} className={`${inputCls} w-full`} /></label>
          <label className="block"><span className={fieldCls}>Monthly (keep N months)</span><input type="number" min={0} value={retDraft.monthly} onChange={(e) => setRetDraft({ ...retDraft, monthly: Math.max(0, Number(e.target.value)) })} className={`${inputCls} w-full`} /></label>
        </div>
      </div>

      <p className="text-xs text-slate-500">Applied automatically after every backup, and on demand via <b>Prune now</b>.</p>
      {canRun ? <button type="submit" disabled={busy} className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">Save retention</button> : null}
    </form>
  ) : <Spinner label="Loading retention…" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Backups</h1>
        <button type="button" onClick={reload} className="text-xs text-slate-500 underline transition-colors hover:text-slate-300">Refresh</button>
      </div>

      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}
      {actionError ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{actionError}</div> : null}
      {note ? <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{note}</div> : null}

      <Tabs
        items={[
          { key: "backups", label: `Backups (${backups.length})`, node: backupsNode },
          { key: "schedules", label: `Schedules (${schedules.length})`, node: schedulesNode },
          { key: "retention", label: "Retention", node: retentionNode },
        ]}
      />
    </div>
  );
}
