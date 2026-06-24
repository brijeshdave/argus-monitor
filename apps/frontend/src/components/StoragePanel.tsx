/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * NAS/storage capacity panel (core slice):
 * reachability + a used/free capacity bar, and a 7-day used-% growth trend (inline
 * SVG). Reads the live StorageSample from a storage monitor's unit meta.
 */
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FolderNode, StorageSample, StorageForecast } from "@argus/shared";
import { api } from "@/lib/api";
import { PeriodSelector } from "@/components/PeriodSelector";
import { Tabs, type TabItem } from "@/components/Tabs";

interface UsagePoint { ts: string; usedPct: number | null }

/** Humanise a days-to-full figure (days → "~3.2 days" / "~5.1 months" / ">2 years"). */
function fmtDaysToFull(days: number | null): string {
  if (days == null) return "—";
  if (days <= 0) return "full now";
  if (days < 90) return `~${days.toFixed(days < 10 ? 1 : 0)} days`;
  if (days < 730) return `~${(days / 30).toFixed(1)} months`;
  return ">2 years";
}

function fmtBytes(b: number | null | undefined): string {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

const fmtCount = (n: number): string => n.toLocaleString();

/** Compact, human-readable count: 1234 → "1.2K", 1_200_000 → "1.2M". */
function fmtCompact(n: number): string {
  if (n < 1000) return String(n);
  const u = ["", "K", "M", "B", "T"];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i += 1; }
  return `${v.toFixed(v >= 10 ? 0 : 1)}${u[i]}`;
}

// ── Folder tree ─────────────────────────────────────────────────────────────
interface TreeNode { name: string; full: string; abs: string; size: number; files: number; folders: number; children: TreeNode[] }

/** Join a base path + a relative folder path, matching the base's separator, and
 *  avoiding a duplicated share segment (SMB labels include the share name). */
function joinPath(base: string, rel: string): string {
  if (!base) return rel;
  const sep = base.includes("\\") ? "\\" : "/";
  const b = base.replace(/[\\/]+$/, "");
  const baseName = b.split(/[\\/]/).pop() ?? "";
  let r = rel;
  if (baseName && (r === baseName || r.startsWith(baseName + "/"))) r = r.slice(baseName.length).replace(/^\//, "");
  return r ? b + sep + r.replace(/\//g, sep) : b;
}

/** Build a nested tree from the flat, path-named FolderNode list ("a/b/c"). */
function buildTree(list: FolderNode[], basePath: string): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  const norm = (s: string) => s.replace(/^\.\//, "").replace(/^\//, ""); // tolerate legacy "./" prefix
  const ensure = (full: string): TreeNode => {
    let n = map.get(full);
    if (!n) { n = { name: full.split("/").pop() || full, full, abs: joinPath(basePath, full), size: 0, files: 0, folders: 0, children: [] }; map.set(full, n); }
    return n;
  };
  for (const f of [...list].map((f) => ({ ...f, name: norm(f.name) })).filter((f) => f.name).sort((a, b) => a.name.localeCompare(b.name))) {
    const n = ensure(f.name);
    n.size = f.sizeBytes; n.files = f.fileCount; n.folders = f.folderCount ?? 0;
    const i = f.name.lastIndexOf("/");
    if (i >= 0) ensure(f.name.slice(0, i)).children.push(n);
    else roots.push(n);
  }
  const sortRec = (nodes: TreeNode[]) => { nodes.sort((a, b) => b.size - a.size); nodes.forEach((c) => sortRec(c.children)); };
  sortRec(roots);
  return roots;
}

function TreeRow({ node, depth, expanded, toggle, total, showPath, selected, onSelect }: { node: TreeNode; depth: number; expanded: Set<string>; toggle: (k: string) => void; total: number; showPath: boolean; selected: string | null; onSelect: (k: string) => void }) {
  const hasKids = node.children.length > 0;
  const open = expanded.has(node.full);
  const pct = total > 0 ? (node.size / total) * 100 : 0;
  return (
    <>
      <div className={`rounded-md px-3 py-2 transition-colors hover:bg-slate-800/40 ${selected === node.full ? "bg-sky-500/10" : ""}`} style={{ marginLeft: `${depth * 14}px` }}>
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => hasKids && toggle(node.full)} className="flex min-w-0 items-center gap-1.5 text-left">
            <span className="w-3 shrink-0 text-slate-500">{hasKids ? (open ? "▾" : "▸") : "·"}</span>
            <span className={`truncate font-medium ${hasKids ? "text-slate-100" : "text-slate-300"}`} title={node.abs}>{node.name || "/"}</span>
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-sm tabular-nums text-slate-100">{fmtBytes(node.size)}</span>
            <button type="button" title="Growth chart" onClick={() => onSelect(node.full)} className={`px-1 ${selected === node.full ? "text-sky-300" : "text-slate-600 hover:text-sky-300"}`}>📈</button>
          </div>
        </div>
        {showPath ? <div className="truncate pl-[1.125rem] font-mono text-[0.65rem] text-slate-500" title={node.abs}>{node.abs}</div> : null}
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-sky-500/70" style={{ width: `${Math.max(1.5, Math.min(100, pct))}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between text-[0.7rem] text-slate-500">
          <span>{fmtCompact(node.files)} files · {node.folders ? `${fmtCompact(node.folders)} subfolders` : "no subfolders"}</span>
          <span className="tabular-nums">{pct.toFixed(pct < 10 ? 1 : 0)}% of total</span>
        </div>
      </div>
      {open && node.children.map((c) => <TreeRow key={c.full} node={c} depth={depth + 1} expanded={expanded} toggle={toggle} total={total} showPath={showPath} selected={selected} onSelect={onSelect} />)}
    </>
  );
}

interface FolderPoint { ts: string; sizeBytes: number | null; fileCount: number | null; folderCount: number | null }

/** Aggregate hourly points into daily or monthly buckets (last value of each bucket). */
function bucketize(points: FolderPoint[], gran: "day" | "month"): Array<{ label: string; size: number; files: number }> {
  const by = new Map<string, FolderPoint>();
  for (const p of points) {
    const d = new Date(p.ts);
    const key = gran === "month"
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    by.set(key, p); // points are ordered ascending → last write wins = latest in bucket
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, p]) => ({
    label: gran === "month" ? label : label.slice(5), // "MM-DD" for day, "YYYY-MM" for month
    size: p.sizeBytes ?? 0,
    files: p.fileCount ?? 0,
  }));
}

/** Growth history chart for one folder — size (bars) + file count (line), day/month. */
function FolderChart({ monitorId, folder, onClose }: { monitorId: string; folder: string; onClose: () => void }) {
  const [points, setPoints] = useState<FolderPoint[]>([]);
  const [period, setPeriod] = useState("hours=2160");
  const [gran, setGran] = useState<"day" | "month">("day");
  useEffect(() => {
    let cancelled = false;
    api.get<{ points: FolderPoint[] }>(`/api/monitors/${monitorId}/folder-metrics?folder=${encodeURIComponent(folder)}&${period}`)
      .then((r) => { if (!cancelled) setPoints(r.points); }, () => {});
    return () => { cancelled = true; };
  }, [monitorId, folder, period]);
  const data = useMemo(() => bucketize(points, gran), [points, gran]);

  const granBtn = (g: "day" | "month", label: string) => (
    <button type="button" onClick={() => setGran(g)} className={`rounded-md px-2 py-0.5 text-xs transition-colors ${gran === g ? "bg-sky-500 text-slate-950" : "border border-slate-700 text-slate-300 hover:border-slate-500"}`}>{label}</button>
  );

  return (
    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-slate-200" title={folder}>📈 {folder}</span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">{granBtn("day", "Day-wise")}{granBtn("month", "Month-wise")}</div>
          <PeriodSelector value={period} onChange={setPeriod} />
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-300">✕</button>
        </div>
      </div>
      {data.length < 2 ? (
        <div className="py-10 text-center text-sm text-slate-500">Not enough history yet — folder snapshots are recorded ~hourly, so {gran}-wise growth builds up over time.</div>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id="folderSize" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.35} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#232c38" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#8a9cb0", fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis yAxisId="s" tickFormatter={(v: number) => fmtBytes(v)} tick={{ fill: "#8a9cb0", fontSize: 11 }} width={64} />
              <YAxis yAxisId="f" orientation="right" tickFormatter={(v: number) => fmtCompact(v)} tick={{ fill: "#a78bfa", fontSize: 11 }} width={48} />
              <Tooltip contentStyle={{ background: "#12161c", border: "1px solid #232c38", borderRadius: 8, color: "#eef3f9", fontSize: 12 }} formatter={(v: number, n) => [n === "Size" ? fmtBytes(v) : fmtCount(v), n]} cursor={{ fill: "#ffffff08" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="s" dataKey="size" name="Size" fill="url(#folderSize)" radius={[3, 3, 0, 0]} maxBarSize={48} />
              <Line yAxisId="f" type="monotone" dataKey="files" name="Files" stroke="#a78bfa" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** A plain, simple table of just the TOP-LEVEL folders (name · subfolders · files · size). */
function TopFoldersTable({ folders, basePath }: { folders: FolderNode[]; basePath: string }) {
  const rows = useMemo(() => {
    const norm = (s: string) => s.replace(/^\.\//, "").replace(/^\//, "");
    return folders
      .map((f) => ({ ...f, name: norm(f.name) }))
      .filter((f) => f.name && !f.name.includes("/")) // top level only
      .sort((a, b) => b.sizeBytes - a.sizeBytes);
  }, [folders]);
  const total = rows.reduce((a, r) => ({ size: a.size + r.sizeBytes, files: a.files + r.fileCount, folders: a.folders + (r.folderCount ?? 0) }), { size: 0, files: 0, folders: 0 });
  const max = Math.max(1, ...rows.map((r) => r.sizeBytes));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-left text-[0.6rem] uppercase tracking-wide text-slate-500">
            <th className="py-1.5 pr-2 font-medium">Folder</th>
            <th className="px-2 py-1.5 text-right font-medium">Subfolders</th>
            <th className="px-2 py-1.5 text-right font-medium">Files</th>
            <th className="px-2 py-1.5 text-right font-medium">Size</th>
            <th className="w-32 py-1.5 pl-2 font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-slate-800/50 hover:bg-slate-800/30">
              <td className="py-2 pr-2 font-medium text-slate-200" title={joinPath(basePath, r.name)}>{r.name}</td>
              <td className="px-2 py-2 text-right tabular-nums text-slate-400" title={`${fmtCount(r.folderCount ?? 0)} subfolders`}>{r.folderCount ? fmtCompact(r.folderCount) : "—"}</td>
              <td className="px-2 py-2 text-right tabular-nums text-slate-400" title={`${fmtCount(r.fileCount)} files`}>{fmtCompact(r.fileCount)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-slate-100">{fmtBytes(r.sizeBytes)}</td>
              <td className="py-2 pl-2">
                <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-sky-500/70" style={{ width: `${Math.max(2, (r.sizeBytes / max) * 100)}%` }} /></div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-700 text-sm font-medium text-slate-200">
            <td className="py-2 pr-2">Total ({rows.length})</td>
            <td className="px-2 py-2 text-right tabular-nums" title={`${fmtCount(total.folders)} subfolders`}>{fmtCompact(total.folders)}</td>
            <td className="px-2 py-2 text-right tabular-nums" title={`${fmtCount(total.files)} files`}>{fmtCompact(total.files)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{fmtBytes(total.size)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function FolderTree({ folders, note, monitorId, basePath }: { folders: FolderNode[]; note?: string | null; monitorId: string; basePath: string }) {
  const tree = useMemo(() => buildTree(folders, basePath), [folders, basePath]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(tree.map((n) => n.full)));
  const [showPath, setShowPath] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const toggle = (k: string) => setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const onSelect = (k: string) => setSelected((s) => (s === k ? null : k));
  const allKeys = () => { const ks: string[] = []; const walk = (ns: TreeNode[]) => ns.forEach((n) => { ks.push(n.full); walk(n.children); }); walk(tree); return ks; };
  const total = tree.reduce((a, n) => ({ size: a.size + n.size, files: a.files + n.files, folders: a.folders + n.folders }), { size: 0, files: 0, folders: 0 });
  return (
    <div className="text-sm">
      {note ? <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">{note}</div> : null}
      {/* Capacity-style summary header */}
      <div className="mb-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <div className="flex items-end justify-between">
          <span className="font-mono text-2xl text-slate-100">{fmtBytes(total.size)}</span>
          <span className="text-sm text-slate-400">{fmtCount(total.files)} files · {fmtCount(total.folders)} folders · {tree.length} top-level</span>
        </div>
        <div className="mt-2 flex items-center justify-end gap-3 text-xs">
          <button type="button" onClick={() => setExpanded(new Set(allKeys()))} className="text-slate-400 hover:text-slate-200">Expand all</button>
          <button type="button" onClick={() => setExpanded(new Set())} className="text-slate-400 hover:text-slate-200">Collapse all</button>
          <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={showPath} onChange={(e) => setShowPath(e.target.checked)} className="h-3 w-3 rounded border-slate-700 bg-slate-950" />Full path</label>
        </div>
      </div>
      <p className="mb-2 text-xs text-slate-500">Click a folder to see its <span className="text-slate-300">scan history</span> 📈 (size + file-count over time). Snapshots are recorded ~hourly and kept per <span className="text-slate-300">Settings → Retention → Folder snapshots</span>.</p>
      <div className="max-h-[30rem] space-y-0.5 overflow-y-auto pr-1">
        {tree.map((n) => <TreeRow key={n.full} node={n} depth={0} expanded={expanded} toggle={toggle} total={total.size} showPath={showPath} selected={selected} onSelect={onSelect} />)}
      </div>
      {selected ? <FolderChart monitorId={monitorId} folder={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function barColor(pct: number): string {
  if (pct >= 90) return "bg-status-down";
  if (pct >= 75) return "bg-status-degraded";
  return "bg-status-up";
}

interface ScanProgress { folders: number; files: number; bytes: number; current: string }
interface ScanState { status: "idle" | "running" | "paused" | "done" | "cancelled" | "error"; progress?: ScanProgress; startedAt?: string; finishedAt?: string; error?: string | null; cachedAt?: string }

/** Manual scan controls + live progress. `canPause` is off for agent-collected scans
 *  (the agent supports Scan now + Cancel + streamed progress, but not pause/resume). */
function ScanControls({ monitorId, canPause = true }: { monitorId: string; canPause?: boolean }) {
  const [scan, setScan] = useState<ScanState | null>(null);
  const [busy, setBusy] = useState(false);
  const running = scan?.status === "running" || scan?.status === "paused";

  useEffect(() => {
    let cancelled = false;
    const load = () => api.get<{ scan: ScanState }>(`/api/monitors/${monitorId}/scan`).then((r) => { if (!cancelled) setScan(r.scan); }, () => {});
    void load();
    // Poll fast while a scan is in flight, slowly otherwise.
    const t = setInterval(load, running ? 1500 : 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [monitorId, running]);

  const act = async (path: string) => {
    setBusy(true);
    try { const r = await api.post<{ scan: ScanState }>(`/api/monitors/${monitorId}/scan${path}`, {}); setScan(r.scan); } catch { /* ignore */ } finally { setBusy(false); }
  };

  const p = scan?.progress;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-slate-800 bg-slate-900/40 px-2 py-1.5 text-xs">
      {!running ? (
        <button type="button" disabled={busy} onClick={() => act("")} className="rounded bg-sky-600/80 px-2 py-1 font-medium text-white hover:bg-sky-600 disabled:opacity-50">Scan now</button>
      ) : (
        <>
          {canPause ? (scan?.status === "paused"
            ? <button type="button" disabled={busy} onClick={() => act("/resume")} className="rounded border border-slate-600 px-2 py-1 text-slate-200 hover:border-slate-400">Resume</button>
            : <button type="button" disabled={busy} onClick={() => act("/pause")} className="rounded border border-slate-600 px-2 py-1 text-slate-200 hover:border-slate-400">Pause</button>) : null}
          <button type="button" disabled={busy} onClick={() => act("/cancel")} className="rounded border border-rose-600/50 px-2 py-1 text-rose-300 hover:border-rose-500">Cancel</button>
        </>
      )}
      {running && p ? (
        <span className="flex-1 truncate text-slate-400">
          <span className="text-sky-300">{scan?.status}</span> · {fmtCompact(p.folders)} folders · {fmtCompact(p.files)} files · {fmtBytes(p.bytes)}
          {p.current ? <span className="ml-1 text-slate-600" title={p.current}>· {p.current.split(/[\\/]/).slice(-2).join("/")}</span> : null}
        </span>
      ) : (
        <span className="flex-1 truncate text-slate-500">
          {scan?.status === "error" ? <span className="text-rose-400">scan error: {scan.error}</span>
            : scan?.status === "cancelled" ? <span className="text-amber-300">last scan cancelled{p ? ` · ${fmtCompact(p.folders)} folders` : ""}</span>
            : scan?.status === "done" ? <span className="text-emerald-300">scan complete{p ? ` · ${fmtCompact(p.folders)} folders · ${fmtCompact(p.files)} files · ${fmtBytes(p.bytes)}` : ""}{scan.finishedAt ? ` · ${new Date(scan.finishedAt).toLocaleTimeString()}` : ""}</span>
            : scan?.cachedAt ? `last scanned ${new Date(scan.cachedAt).toLocaleString()}`
            : "no scan yet — runs on schedule, or click Scan now"}
        </span>
      )}
    </div>
  );
}

export function StoragePanel({ monitorId, name, storage, status, serverSide = false, basePath = "" }: { monitorId: string; name: string; storage: StorageSample; status: string; serverSide?: boolean; basePath?: string }) {
  const [trend, setTrend] = useState<UsagePoint[]>([]);
  const [forecast, setForecast] = useState<StorageForecast | null>(null);
  const [period, setPeriod] = useState("hours=720");
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api.get<{ points: UsagePoint[]; forecast: StorageForecast | null }>(`/api/monitors/${monitorId}/storage-metrics?${period}`).then(
        (r) => { if (!cancelled) { setTrend(r.points); setForecast(r.forecast); } },
        () => {},
      );
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [monitorId, period]);

  const pct = storage.usedPct ?? null;
  const chart = trend
    .filter((p) => p.usedPct != null)
    .map((p) => ({ t: new Date(p.ts).getTime(), pct: p.usedPct as number }));

  const capacityNode = (
    <div className="space-y-3">
      <div className="flex items-end justify-between text-sm">
        <span className="font-mono text-2xl text-slate-100">{pct != null ? `${pct.toFixed(1)}%` : "—"}</span>
        <span className="text-slate-400">{fmtBytes(storage.usedBytes)} / {fmtBytes(storage.totalBytes)} · {fmtBytes(storage.freeBytes)} free</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${pct == null ? "" : barColor(pct)}`} style={{ width: `${pct == null ? 0 : Math.max(2, Math.min(100, pct))}%` }} />
      </div>
      {forecast ? (
        <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-3 text-sm">
          <div>
            <div className="text-[0.65rem] uppercase tracking-wide text-slate-500">Growth</div>
            <div className="text-slate-200">{forecast.growthBytesPerDay >= 0 ? "+" : "−"}{fmtBytes(Math.abs(forecast.growthBytesPerDay))}/day</div>
          </div>
          <div>
            <div className="text-[0.65rem] uppercase tracking-wide text-slate-500">Days to full</div>
            <div className={forecast.daysToFull != null && forecast.daysToFull < 30 ? "font-medium text-status-down" : "text-slate-200"}>
              {fmtDaysToFull(forecast.daysToFull)}
              {forecast.projectedFullDate ? <span className="ml-1 text-xs text-slate-500">({new Date(forecast.projectedFullDate).toLocaleDateString()})</span> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  const historyNode = (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[0.65rem] uppercase tracking-wide text-slate-500">Used % history</span>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>
      {chart.length < 2 ? (
        <div className="py-6 text-xs text-slate-500">Not enough history in this window yet.</div>
      ) : (
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart} margin={{ top: 5, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232c38" />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={(t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })} tick={{ fill: "#8a9cb0", fontSize: 10 }} minTickGap={40} />
              <YAxis domain={[0, 100]} unit="%" tick={{ fill: "#8a9cb0", fontSize: 10 }} width={40} />
              <Tooltip contentStyle={{ background: "#12161c", border: "1px solid #232c38", borderRadius: 8, color: "#eef3f9", fontSize: 12 }} labelFormatter={(t) => new Date(Number(t)).toLocaleString()} formatter={(v: number) => [`${v.toFixed(1)}%`, "Used"]} />
              <Area type="monotone" dataKey="pct" stroke="#22c55e" fill="#22c55e22" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );

  const tabs: TabItem[] = [
    { key: "capacity", label: "Capacity", node: capacityNode },
    { key: "history", label: "History", node: historyNode },
  ];
  const hasFolders = !!storage.folders && storage.folders.length > 0;
  if (hasFolders) {
    tabs.push({
      key: "topfolders",
      label: "Top folders",
      node: (
        <div>
          <ScanControls monitorId={monitorId} canPause={serverSide} />
          <TopFoldersTable folders={storage.folders!} basePath={basePath} />
        </div>
      ),
    });
  }
  if (hasFolders || serverSide) {
    tabs.push({
      key: "folders",
      label: hasFolders ? `Folder tree (${storage.folders!.length})` : "Folder tree",
      node: (
        <div>
          <ScanControls monitorId={monitorId} canPause={serverSide} />
          {hasFolders
            ? <FolderTree folders={storage.folders!} note={storage.error} monitorId={monitorId} basePath={basePath} />
            : <p className="py-4 text-xs text-slate-500">No folder data yet{serverSide ? " — click “Scan now”, or it runs automatically on the watched-folder period." : "."}</p>}
        </div>
      ),
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-slate-100">{name}</h3>
        <span className="text-xs uppercase tracking-wide text-slate-500">NAS · {storage.reachable ? status : "unreachable"}</span>
      </div>
      {storage.reachable ? (
        <Tabs items={tabs} />
      ) : (
        <p className="text-sm text-status-down">Share unreachable — check the path, network, or SMB credentials.</p>
      )}
    </div>
  );
}
