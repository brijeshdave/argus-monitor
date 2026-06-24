/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Wallboard builder: a drag-and-drop (dnd-kit) grid of live status tiles. The
 * default/system layout is read-only (clone-to-customize) and previews the whole
 * fleet; editable layouts can add, remove, reorder, size, group and choose the
 * detail rows of each tile, then save the layout JSON.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import type { WallLayoutDTO } from "@argus/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/auth/AuthContext";
import { Spinner } from "@/components/Spinner";
import { PromptDialog } from "@/components/PromptDialog";
import { WallTile } from "@/components/WallTile";
import { useTileSeries } from "@/hooks/useTileSeries";
import type { MonitorSeries } from "@argus/shared";
import {
  ALL_METRICS,
  readWidgets,
  useWallEntities,
  type ResolvedWidget,
  type Widget,
  type WidgetKind,
  type WidgetMetric,
} from "@/hooks/useWallEntities";

const uid = () => `w_${Math.random().toString(36).slice(2, 10)}`;
const METRIC_LABEL: Record<WidgetMetric, string> = { latency: "Latency", since: "For", uptime: "Uptime" };

/** One editable tile: live preview + size / group / detail controls. */
function SortableTile({ widget, resolved, series, onChange, onRemove }: {
  widget: Widget; resolved: ResolvedWidget; series?: MonitorSeries; onChange: (patch: Partial<Widget>) => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const metrics = widget.metrics ?? ALL_METRICS;
  const toggleMetric = (m: WidgetMetric) =>
    onChange({ metrics: metrics.includes(m) ? metrics.filter((x) => x !== m) : [...metrics, m] });

  return (
    <div ref={setNodeRef} style={style} className={`rounded-lg border p-2 ${resolved.missing ? "border-amber-700/50 bg-amber-500/5" : "border-slate-800 bg-slate-900/40"}`}>
      <div className="mb-1 flex items-center justify-between">
        <span {...attributes} {...listeners} className="cursor-grab text-xs text-slate-500" title="Drag to reorder">⠿ drag</span>
        <button onClick={onRemove} className="text-slate-500 hover:text-rose-400" title="Remove">✕</button>
      </div>
      {resolved.missing ? (
        <div className="px-2 py-3 text-xs text-amber-300">Removed — entity no longer exists. Remove this tile.</div>
      ) : (
        <WallTile widget={widget} resolved={resolved} uptimePct={series?.uptimePct} sparkline={series?.latency} />
      )}

      {/* Per-tile controls */}
      <div className="mt-2 space-y-2 border-t border-slate-800 pt-2">
        <div className="flex items-center gap-1 text-xs">
          <span className="text-slate-500">Size</span>
          {(["sm", "lg"] as const).map((s) => (
            <button
              key={s}
              onClick={() => onChange({ size: s })}
              className={`rounded px-1.5 py-0.5 ${(widget.size ?? "sm") === s ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300"}`}
            >
              {s === "sm" ? "S" : "L"}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={widget.group ?? ""}
          onChange={(e) => onChange({ group: e.target.value })}
          placeholder="Group heading…"
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
        />
        <div className="flex flex-wrap gap-2 text-xs text-slate-400">
          {ALL_METRICS.map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input type="checkbox" checked={metrics.includes(m)} onChange={() => toggleMetric(m)} className="h-3 w-3" />
              {METRIC_LABEL[m]}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WallboardBuilder() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { has } = useAuth();
  const entities = useWallEntities();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const [layout, setLayout] = useState<WallLayoutDTO | null>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ layout: WallLayoutDTO }>(`/api/wallboards/${id}`);
        setLayout(res.layout);
        setWidgets(readWidgets(res.layout.layout));
      } catch {
        setError("Failed to load layout.");
      }
    })();
  }, [id]);

  const locked = !layout || layout.isDefault || layout.isSystem || !has("wallboards:write");

  const options = useMemo(() => [
    ...entities.agents.map((a) => ({ kind: "agent" as WidgetKind, refId: a.id, label: `agent · ${a.name}` })),
    ...entities.monitors.map((m) => ({ kind: "monitor" as WidgetKind, refId: m.id, label: `monitor · ${m.name}` })),
  ], [entities.agents, entities.monitors]);

  // Already-placed entities, so the same agent/monitor can't be added twice.
  const present = useMemo(() => new Set(widgets.map((w) => `${w.kind}:${w.refId}`)), [widgets]);

  // Latency/uptime series for whichever tiles are shown (default fleet or own).
  const shownWidgets = layout?.isDefault ? entities.defaultWidgets() : widgets;
  const seriesIds = useMemo(() => shownWidgets.filter((w) => w.kind === "monitor").map((w) => w.refId), [shownWidgets]);
  const series = useTileSeries(seriesIds);

  if (!layout) return error ? <p className="text-rose-400">{error}</p> : <Spinner label="Loading layout…" />;

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setWidgets((ws) => {
      const from = ws.findIndex((w) => w.id === active.id);
      const to = ws.findIndex((w) => w.id === over.id);
      return from < 0 || to < 0 ? ws : arrayMove(ws, from, to);
    });
  }

  function addWidget(value: string) {
    const opt = options.find((o) => `${o.kind}:${o.refId}` === value);
    if (!opt) return;
    const key = `${opt.kind}:${opt.refId}`;
    setWidgets((ws) => (ws.some((w) => `${w.kind}:${w.refId}` === key) ? ws : [...ws, { id: uid(), kind: opt.kind, refId: opt.refId }]));
  }

  /** Add every monitor of an agent (and the agent tile) that isn't already placed. */
  function addAllForAgent(agentId: string) {
    setWidgets((ws) => {
      const has2 = new Set(ws.map((w) => `${w.kind}:${w.refId}`));
      const next = [...ws];
      const group = entities.agents.find((a) => a.id === agentId)?.name;
      if (!has2.has(`agent:${agentId}`)) next.push({ id: uid(), kind: "agent", refId: agentId, group, size: "lg" });
      for (const m of entities.monitors.filter((m) => m.agentId === agentId)) {
        if (!has2.has(`monitor:${m.id}`)) next.push({ id: uid(), kind: "monitor", refId: m.id, group });
      }
      return next;
    });
  }

  function patchWidget(wid: string, patch: Partial<Widget>) {
    setWidgets((ws) => ws.map((w) => (w.id === wid ? { ...w, ...patch } : w)));
  }

  async function save() {
    try {
      await api.patch(`/api/wallboards/${id}`, { layout: { widgets } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Save failed.");
    }
  }

  async function cloneAndEdit(name: string) {
    const res = await api.post<{ layout: WallLayoutDTO }>(`/api/wallboards/${id}/clone`, { name });
    setCloning(false);
    navigate(`/wallboards/${res.layout.id}`);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{layout.name}</h1>
          <p className="text-sm text-slate-500">{layout.description || "Wallboard layout"}</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/wall/${id}?fullscreen=1`} target="_blank" rel="noreferrer" className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:text-slate-100">Open kiosk ↗</a>
          {!locked && <button onClick={save} className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500">Save</button>}
          {saved && <span className="text-sm text-emerald-400">Saved ✓</span>}
        </div>
      </div>

      {locked && (
        <div className="mb-4 rounded-md border border-amber-700/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {layout.isDefault || layout.isSystem
            ? "This is the protected default layout — it auto-shows the whole fleet. Clone it to customize."
            : "You don't have permission to edit wallboards."}
          {(layout.isDefault || layout.isSystem) && (
            <button onClick={() => setCloning(true)} className="ml-3 rounded bg-amber-600/80 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600">Clone & edit</button>
          )}
        </div>
      )}

      {!locked && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select onChange={(e) => { addWidget(e.target.value); e.target.value = ""; }} defaultValue="" className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm">
            <option value="" disabled>+ Add tile…</option>
            {options.map((o) => {
              const key = `${o.kind}:${o.refId}`;
              const added = present.has(key);
              return (
                <option key={key} value={key} disabled={added}>
                  {o.label}{added ? " ✓ added" : ""}
                </option>
              );
            })}
          </select>
          <select onChange={(e) => { if (e.target.value) addAllForAgent(e.target.value); e.target.value = ""; }} defaultValue="" className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm">
            <option value="" disabled>+ Add all monitors for agent…</option>
            {entities.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <span className="text-xs text-slate-500">{widgets.length} tile(s)</span>
        </div>
      )}

      {locked ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shownWidgets.map((w) => {
            const r = entities.resolve(w);
            if (r.missing) return null;
            const s = w.kind === "monitor" ? series[w.refId] : undefined;
            return <div key={w.id} className={w.size === "lg" ? "sm:col-span-2" : ""}><WallTile widget={w} resolved={r} uptimePct={s?.uptimePct} sparkline={s?.latency} /></div>;
          })}
          {shownWidgets.length === 0 && <p className="text-sm text-slate-500">Nothing to show yet.</p>}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {widgets.map((w) => (
                <SortableTile
                  key={w.id}
                  widget={w}
                  resolved={entities.resolve(w)}
                  series={w.kind === "monitor" ? series[w.refId] : undefined}
                  onChange={(patch) => patchWidget(w.id, patch)}
                  onRemove={() => setWidgets((ws) => ws.filter((x) => x.id !== w.id))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {!locked && widgets.length === 0 && <p className="mt-6 text-sm text-slate-500">No tiles yet. Add one above.</p>}

      {cloning ? (
        <PromptDialog
          title="Clone & edit wallboard"
          label="Name for the editable copy"
          defaultValue={`${layout.name} copy`}
          confirmLabel="Clone & edit"
          onCancel={() => setCloning(false)}
          onSubmit={cloneAndEdit}
        />
      ) : null}
    </div>
  );
}
