/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Wallboard Display settings — a full page (not a modal) for configuring how a board
 * renders on screens: appearance (title/icon/layout/rotation), which hosts show, and per
 * host which metrics, monitors, storage volumes, SNMP OID readings and disk health appear.
 * All server-side (re-polled by displays). Available SNMP/storage items are enumerated
 * from each host's live sample so you only pick from what actually exists.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { WALL_PANEL_METRICS, WALL_TEMPLATES, type MonitorDTO, type WallLayoutDTO, type WallPanelConfig, type WallPanelMetric, type WallSnmpSelection, type WallTemplate } from "@argus/shared";
import { api } from "@/lib/api";
import { useWallboards } from "@/hooks/useWallboards";
import { useWallEntities } from "@/hooks/useWallEntities";
import { useLiveState } from "@/hooks/useLiveState";
import { Spinner } from "@/components/Spinner";
import { WALL_ICONS, WALL_ICON_NAMES } from "@/lib/wallIcons";

const LAYOUTS: { value: WallTemplate; label: string }[] = [
  { value: "flex", label: "Flex — as many panels as fit" },
  { value: "cols2", label: "2 columns" },
  { value: "cols3", label: "3 columns" },
  { value: "rows2", label: "2 rows" },
  { value: "single", label: "Single host (one per screen, rotating)" },
];
const ROTATIONS = [3, 5, 10, 20, 30, 60, 0];
const METRIC_LABEL: Record<WallPanelMetric, string> = {
  services: "Services", databases: "DBs", sessions: "Sessions", clients: "Clients", cpu: "CPU", ram: "RAM", net: "Net", storage: "Disk",
};
const ALL_METRICS = WALL_PANEL_METRICS as readonly WallPanelMetric[];
void WALL_TEMPLATES;

/** What SNMP/storage detail a host actually reports right now (to pick from). */
interface HostAvail { volumes: string[]; items: string[]; hasDisks: boolean; monitors: string[] }

function Chip({ on, tone = "sky", onClick, children }: { on: boolean; tone?: "sky" | "emerald" | "violet"; onClick: () => void; children: React.ReactNode }) {
  const onCls = tone === "emerald" ? "bg-emerald-500/15 text-emerald-200 ring-emerald-500/40" : tone === "violet" ? "bg-violet-500/15 text-violet-200 ring-violet-500/40" : "bg-sky-500/15 text-sky-200 ring-sky-500/40";
  return <button type="button" onClick={onClick} className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ${on ? onCls : "text-slate-500 ring-slate-700 hover:text-slate-300"}`}>{children}</button>;
}

export function WallboardDisplayPage() {
  const { id = "" } = useParams();
  const { setTemplate: saveTemplate, setRotate, setPanel } = useWallboards();
  const { agents, monitors } = useWallEntities();
  const { unitFor } = useLiveState();

  const [layout, setLayout] = useState<WallLayoutDTO | null>(null);
  const [template, setTemplate] = useState<WallTemplate>("flex");
  const [rotateSec, setRotateSec] = useState(10);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [mode, setMode] = useState<"panels" | "tiles">("panels");
  const [allHosts, setAllHosts] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [metrics, setMetrics] = useState<Record<string, WallPanelMetric[]>>({});
  const [monitorsSel, setMonitorsSel] = useState<Record<string, string[]>>({});
  const [snmp, setSnmp] = useState<Record<string, WallSnmpSelection>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api.get<{ layout: WallLayoutDTO }>(`/api/wallboards/${id}`).then(({ layout: l }) => {
      const pc = l.panelConfig ?? {};
      setLayout(l);
      setTemplate(l.template); setRotateSec(l.rotateSec);
      setTitle(pc.title ?? ""); setIcon(pc.icon ?? "");
      setMode(pc.mode ?? (l.isDefault ? "panels" : "tiles"));
      setAllHosts(!pc.hosts || pc.hosts.length === 0);
      setSelected(new Set(pc.hosts ?? []));
      setMetrics({ ...(pc.metrics ?? {}) });
      setMonitorsSel({ ...(pc.monitors ?? {}) });
      setSnmp({ ...(pc.snmp ?? {}) });
    }, () => setErr("Failed to load this wallboard."));
  }, [id]);

  // Per-host: which monitors exist, and which storage volumes / SNMP OID items / disks
  // the host is currently reporting — so the operator picks only from what's real.
  const availByHost = useMemo(() => {
    const map = new Map<string, HostAvail>();
    for (const a of agents) {
      const mons = monitors.filter((m: MonitorDTO) => m.agentId === a.id);
      const volumes = new Set<string>();
      const items = new Set<string>();
      let hasDisks = false;
      const monNames: string[] = [];
      for (const m of mons) {
        if (m.type === "ping" && (m.config as { default?: unknown }).default === true) continue;
        monNames.push(m.name);
        const meta = unitFor(a.id, m.name)?.meta;
        if (meta?.storage) volumes.add(m.name);
        const snmpS = meta?.snmp;
        if (snmpS) {
          for (const v of snmpS.volumes ?? []) volumes.add(v.name);
          for (const it of snmpS.items ?? []) items.add(it.label);
          if ((snmpS.disks ?? []).length) hasDisks = true;
        }
      }
      map.set(a.id, { volumes: [...volumes], items: [...items], hasDisks, monitors: monNames });
    }
    return map;
  }, [agents, monitors, unitFor]);

  if (err) return <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{err}</div>;
  if (!layout) return <Spinner label="Loading display settings…" />;

  const shownMetrics = (hid: string): WallPanelMetric[] => metrics[hid] ?? [...ALL_METRICS];
  const toggleMetric = (hid: string, m: WallPanelMetric) => setMetrics((p) => { const cur = p[hid] ?? [...ALL_METRICS]; return { ...p, [hid]: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] }; });
  const shownMonitors = (hid: string): string[] => monitorsSel[hid] ?? (availByHost.get(hid)?.monitors ?? []);
  const toggleMonitor = (hid: string, n: string) => setMonitorsSel((p) => { const cur = shownMonitors(hid); return { ...p, [hid]: cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n] }; });
  const shownVolumes = (hid: string): string[] => snmp[hid]?.volumes ?? (availByHost.get(hid)?.volumes ?? []);
  const toggleVolume = (hid: string, n: string) => setSnmp((p) => { const cur = shownVolumes(hid); const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]; return { ...p, [hid]: { ...p[hid], volumes: next } }; });
  const shownItems = (hid: string): string[] => snmp[hid]?.items ?? [];
  const toggleItem = (hid: string, n: string) => setSnmp((p) => { const cur = shownItems(hid); const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]; return { ...p, [hid]: { ...p[hid], items: next } }; });
  const disksOn = (hid: string): boolean => snmp[hid]?.disks !== false;
  const toggleDisks = (hid: string) => setSnmp((p) => ({ ...p, [hid]: { ...p[hid], disks: !disksOn(hid) } }));
  const toggleHost = (hid: string) => setSelected((p) => { const n = new Set(p); n.has(hid) ? n.delete(hid) : n.add(hid); return n; });

  async function save() {
    if (!layout) return;
    setSaving(true); setErr(null); setSaved(false);
    try {
      const cMetrics: Record<string, WallPanelMetric[]> = {};
      for (const [hid, ms] of Object.entries(metrics)) if (ms.length !== ALL_METRICS.length) cMetrics[hid] = ms;
      const cMonitors: Record<string, string[]> = {};
      for (const [hid, names] of Object.entries(monitorsSel)) { const all = availByHost.get(hid)?.monitors ?? []; if (names.length !== all.length) cMonitors[hid] = names; }
      const cSnmp: Record<string, WallSnmpSelection> = {};
      for (const [hid, sel] of Object.entries(snmp)) {
        const all = availByHost.get(hid);
        const out: WallSnmpSelection = {};
        if (sel.volumes && all && sel.volumes.length !== all.volumes.length) out.volumes = sel.volumes;
        if (sel.items && sel.items.length > 0) out.items = sel.items;
        if (sel.disks === false) out.disks = false;
        if (Object.keys(out).length) cSnmp[hid] = out;
      }
      const panel: WallPanelConfig = {
        mode, hosts: allHosts ? null : [...selected], metrics: cMetrics, monitors: cMonitors, snmp: cSnmp,
        title: title.trim() || undefined, icon: icon || undefined,
      };
      if (template !== layout.template) await saveTemplate(layout.id, template);
      if (rotateSec !== layout.rotateSec) await setRotate(layout.id, rotateSec);
      await setPanel(layout.id, panel);
      setSaved(true);
    } catch { setErr("Save failed. Please try again."); }
    finally { setSaving(false); }
  }

  const showScoping = mode === "panels";

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/wallboards" className="text-xs text-slate-500 hover:text-slate-300">← Wallboards</Link>
          <h1 className="text-xl font-semibold text-slate-100">Display settings — {layout.name}</h1>
          <p className="text-sm text-slate-400">Applies to every screen showing this board; updates live (no need to touch the display).</p>
        </div>
        <div className="flex items-center gap-3">
          {saved ? <span className="text-sm text-emerald-400">Saved ✓</span> : null}
          <Link to={`/wall/${layout.id}`} target="_blank" rel="noreferrer" className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500">Open kiosk ↗</Link>
          <button type="button" onClick={() => void save()} disabled={saving} className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>

      {/* Appearance */}
      <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-base font-semibold text-slate-100">Appearance</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Title on the wall</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={layout.name} className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500" />
          </label>
          <div>
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Title icon</span>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setIcon("")} className={`rounded-md border px-2 py-1.5 text-xs ${icon === "" ? "border-sky-500 bg-sky-500/10 text-sky-200" : "border-slate-700 text-slate-400 hover:border-slate-500"}`}>None</button>
              {WALL_ICON_NAMES.map((name) => { const Icon = WALL_ICONS[name]!; return <button key={name} type="button" onClick={() => setIcon(name)} className={`grid h-8 w-8 place-items-center rounded-md border ${icon === name ? "border-sky-500 bg-sky-500/10 text-sky-200" : "border-slate-700 text-slate-300 hover:border-slate-500"}`}><Icon size={16} /></button>; })}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Layout</span>
            <select value={template} onChange={(e) => setTemplate(e.target.value as WallTemplate)} className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500">
              {LAYOUTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Auto-rotate</span>
            <select value={rotateSec} onChange={(e) => setRotateSec(Number(e.target.value))} className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500">
              {ROTATIONS.map((s) => <option key={s} value={s}>{s === 0 ? "Paused" : `Every ${s}s`}</option>)}
            </select>
          </label>
        </div>
        {!layout.isDefault ? (
          <div>
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Render as</span>
            <div className="flex gap-2">
              {(["panels", "tiles"] as const).map((m) => <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-md border px-3 py-1.5 text-sm ${mode === m ? "border-sky-500 bg-sky-500/10 text-sky-200" : "border-slate-700 text-slate-300 hover:border-slate-500"}`}>{m === "panels" ? "Rich panels" : "Tiles (Builder)"}</button>)}
            </div>
          </div>
        ) : null}
      </section>

      {/* Hosts + per-host detail */}
      {showScoping ? (
        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-100">Hosts &amp; details</h2>
            <label className="flex items-center gap-1.5 text-xs text-slate-300"><input type="checkbox" checked={allHosts} onChange={(e) => setAllHosts(e.target.checked)} /> All hosts</label>
          </div>
          <p className="text-[11px] text-slate-500">Per host: <span className="text-sky-300">metrics</span> = stat categories · <span className="text-emerald-300">monitors</span> = which services/DBs · <span className="text-violet-300">storage/SNMP</span> = which volumes, OID readings and disk health. All on = automatic.</p>
          <div className="space-y-2">
            {agents.length === 0 ? <p className="text-sm text-slate-500">No hosts yet.</p> : null}
            {agents.map((a) => {
              const included = allHosts || selected.has(a.id);
              const av = availByHost.get(a.id);
              return (
                <div key={a.id} className={`rounded-md border border-slate-800 p-3 ${included ? "" : "opacity-50"}`}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" disabled={allHosts} checked={included} onChange={() => toggleHost(a.id)} />
                    <span className="font-medium text-slate-200">{a.name}</span>
                  </div>
                  {included ? (
                    <div className="mt-2 space-y-2 pl-6">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="w-16 text-[10px] uppercase tracking-wide text-slate-600">Metrics</span>
                        {ALL_METRICS.map((m) => <Chip key={m} on={shownMetrics(a.id).includes(m)} onClick={() => toggleMetric(a.id, m)}>{METRIC_LABEL[m]}</Chip>)}
                      </div>
                      {(av?.monitors.length ?? 0) > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="w-16 text-[10px] uppercase tracking-wide text-slate-600">Monitors</span>
                          {av!.monitors.map((n) => <Chip key={n} tone="emerald" on={shownMonitors(a.id).includes(n)} onClick={() => toggleMonitor(a.id, n)}>{n}</Chip>)}
                        </div>
                      ) : null}
                      {(av?.volumes.length ?? 0) > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="w-16 text-[10px] uppercase tracking-wide text-slate-600">Storage</span>
                          {av!.volumes.map((n) => <Chip key={n} tone="violet" on={shownVolumes(a.id).includes(n)} onClick={() => toggleVolume(a.id, n)}>{n}</Chip>)}
                        </div>
                      ) : null}
                      {(av?.items.length ?? 0) > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="w-16 text-[10px] uppercase tracking-wide text-slate-600">SNMP</span>
                          {av!.items.map((n) => <Chip key={n} tone="violet" on={shownItems(a.id).includes(n)} onClick={() => toggleItem(a.id, n)}>{n}</Chip>)}
                        </div>
                      ) : null}
                      {av?.hasDisks ? (
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-400"><input type="checkbox" checked={disksOn(a.id)} onChange={() => toggleDisks(a.id)} /> Show disk health (SMART · temperature)</label>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <p className="text-sm text-slate-500">This board renders hand-placed tiles — arrange them in the <Link to={`/wallboards/${layout.id}`} className="text-sky-300">Builder</Link>.</p>
      )}
    </div>
  );
}
