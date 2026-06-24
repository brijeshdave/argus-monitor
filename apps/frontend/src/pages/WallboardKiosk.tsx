/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Wallboard kiosk: a full-screen, chrome-less TV view of a layout. Tiles take
 * their status from the live WebSocket feed (no refresh needed — "set up once and
 * forget"); the entity list re-pulls slowly so added/removed entities surface, and
 * dangling tiles (deleted entities) are hidden. The immutable default board renders
 * the WHOLE fleet automatically. Tiles can be grouped under headings and sized; the
 * grid auto-fits any TV. Unacknowledged alerts + the ticker run along the bottom.
 * Mounted OUTSIDE the authenticated AppShell.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { WallLayoutDTO } from "@argus/shared";
import { api } from "@/lib/api";
import { Spinner } from "@/components/Spinner";
import { TickerBar } from "@/components/TickerBar";
import { WallTile } from "@/components/WallTile";
import { readWidgets, useWallEntities } from "@/hooks/useWallEntities";
import { FleetWall, type WallTemplate } from "@/components/FleetWall";
import { WALL_ICONS } from "@/lib/wallIcons";
import { useTileSeries } from "@/hooks/useTileSeries";

interface Note { id: string; plainLanguage: string | null; title: string; severity: string }

function useClock(): { time: string; date: string } {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return {
    time: now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }),
    date: `${dd}-${mm}-${now.getFullYear()}`,
  };
}


export function WallboardKiosk({ forcedLayoutId }: { forcedLayoutId?: string } = {}) {
  const { id: paramId = "" } = useParams();
  // Device mode passes the board to show (resolved from the device's group/assignment);
  // otherwise the board comes from the URL (or the default board).
  const id = forcedLayoutId ?? paramId;
  // Status is live over the socket; the slow poll only refreshes the entity list.
  const entities = useWallEntities(60_000);
  const clock = useClock();
  const rootRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<WallLayoutDTO | null>(null);
  const [alerts, setAlerts] = useState<Note[]>([]);
  const [fullscreen, setFullscreen] = useState(false);

  // Load the board: an explicit :id, else the default (what /wall opens), else first.
  useEffect(() => {
    void (async () => {
      try {
        if (id) {
          const res = await api.get<{ layout: WallLayoutDTO }>(`/api/wallboards/${id}`);
          setLayout(res.layout);
          return;
        }
        const all = await api.get<{ rows: WallLayoutDTO[] }>("/api/wallboards");
        const def = all.rows.find((b) => b.isDefault) ?? all.rows[0];
        setLayout(def ?? null);
      } catch { /* shown as loading */ }
    })();
  }, [id]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get<{ rows: Note[] }>("/api/notifications?acknowledged=false&limit=5");
        setAlerts(res.rows);
      } catch { /* ignore on kiosk */ }
    };
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, []);

  // Keep our flag in sync with the actual fullscreen state, and best-effort auto-
  // Enter fullscreen on open. Browsers BLOCK fullscreen without a user gesture, so we try
  // immediately (works if launched in kiosk mode / with activation) and keep retrying on
  // every click/keypress until it succeeds, then stop listening.
  useEffect(() => {
    const tryFs = () => { if (!document.fullscreenElement) rootRef.current?.requestFullscreen?.().catch(() => {}); };
    const onChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setFullscreen(fs);
      if (fs) detach(); // succeeded → no need to keep listening
    };
    const detach = () => { window.removeEventListener("pointerdown", onGesture); window.removeEventListener("keydown", onGesture); };
    const onGesture = () => tryFs();
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    tryFs();
    return () => { document.removeEventListener("fullscreenchange", onChange); detach(); };
  }, []);

  // Device mode (forced board): heartbeat while the board is mounted (i.e. the /wall page
  // is open on this screen), so the Devices list shows "live" iff the wall is actually
  // open there. Fires on a short interval + when the tab becomes visible again (browsers
  // throttle background timers — the online window allows for that).
  useEffect(() => {
    if (!forcedLayoutId) return;
    const beat = () => void api.post("/api/wall/heartbeat", {}).catch(() => {});
    beat();
    const t = setInterval(beat, 20_000);
    const onVis = () => { if (document.visibilityState === "visible") beat(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [forcedLayoutId]);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  }

  const widgets = useMemo(
    () => (!layout ? [] : layout.isDefault ? entities.defaultWidgets() : readWidgets(layout.layout)),
    [layout, entities],
  );
  const monitorIds = useMemo(() => widgets.filter((w) => w.kind === "monitor").map((w) => w.refId), [widgets]);
  const series = useTileSeries(monitorIds);

  // ── No-scroll, auto-rotating views ─────────────────────────────────────────
  // Tiles are split into screen-sized pages (computed from the live container size)
  // that cycle on a timer, so the wall fits ANY TV with no scrolling.
  const mainRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [page, setPage] = useState(0);
  // Layout template + rotation are SERVER-SIDE per-board settings — the kiosk only
  // obeys them (configured from the web UI). Re-poll so changes apply on the screen
  // without anyone touching it.
  const rotateSec = layout?.rotateSec ?? 10;
  const template: WallTemplate = layout?.template ?? "flex";
  // Render as the rich panel wall when it's the default board or the board opts in.
  const asPanels = Boolean(layout && (layout.isDefault || layout.panelConfig?.mode === "panels"));
  useEffect(() => {
    if (!layout) return;
    const boardId = layout.id;
    const t = setInterval(() => {
      void api.get<{ layout: WallLayoutDTO }>(`/api/wallboards/${boardId}`).then((r) => setLayout(r.layout), () => {});
    }, 20_000);
    return () => clearInterval(t);
  }, [layout?.id]);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [layout]);

  const tiles = useMemo(
    () => widgets.map((w) => ({ w, r: entities.resolve(w) })).filter((t) => !t.r.missing),
    [widgets, entities],
  );
  const cols = Math.max(1, Math.floor(size.w / 240));
  const rows = Math.max(1, Math.floor(size.h / 150));
  const perPage = Math.max(1, cols * rows);
  const pages = Math.max(1, Math.ceil(tiles.length / perPage));

  // Advance pages on the rotation timer (rotateSec = 0 → paused).
  useEffect(() => {
    if (rotateSec <= 0 || pages <= 1) return;
    const t = setInterval(() => setPage((p) => (p + 1) % pages), rotateSec * 1000);
    return () => clearInterval(t);
  }, [rotateSec, pages]);
  useEffect(() => { if (page >= pages) setPage(0); }, [page, pages]);

  if (!layout) return <Spinner label="Loading wallboard…" />;
  const pageTiles = tiles.slice(page * perPage, page * perPage + perPage);

  return (
    <div ref={rootRef} className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-8 py-4">
        <div className="flex items-center gap-3">
          {(() => {
            const Icon = layout.panelConfig?.icon ? WALL_ICONS[layout.panelConfig.icon] : undefined;
            return Icon ? <Icon size={30} strokeWidth={2.5} className="shrink-0 text-sky-400" /> : null;
          })()}
          <h1 className="text-3xl font-extrabold tracking-wide text-slate-50">{layout.panelConfig?.title?.trim() || layout.name}</h1>
        </div>
        <div className="flex items-center gap-4">
          <span
            className={`text-sm ${entities.live ? "text-emerald-400" : "text-slate-500"}`}
            title={entities.live ? "Live feed connected" : "Live feed offline"}
          >
            {entities.live ? "● Live" : "○ Offline"}
          </span>
          {!asPanels && pages > 1 ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span title="View rotation">{page + 1}/{pages}</span>
              <div className="flex gap-1">
                {Array.from({ length: pages }).map((_, i) => (
                  <button key={i} type="button" onClick={() => setPage(i)} className={`h-1.5 w-4 rounded-full ${i === page ? "bg-sky-400" : "bg-slate-700"}`} title={`View ${i + 1}`} />
                ))}
              </div>
            </div>
          ) : null}
          <span className="font-data text-xs text-slate-600" title="Display settings last changed (server-side)">cfg {new Date(layout.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}</span>
          <div className="text-right leading-tight">
            <div className="font-mono text-xl text-slate-300">{clock.time}</div>
            <div className="font-mono text-xs text-slate-500">{clock.date}</div>
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:text-slate-100"
            title={fullscreen ? "Exit full screen" : "Enter full screen"}
          >
            {fullscreen ? "⤡ Exit" : "⤢ Fullscreen"}
          </button>
        </div>
      </header>

      {/* Boards render as the rich NOC wall (per-host panels + live graphs) when set to
          panel mode (always for the default board); otherwise their configured tiles. */}
      {asPanels ? (
        <main className="min-h-0 flex-1 overflow-hidden">
          <FleetWall rotateSec={rotateSec} template={template} agentIds={layout.panelConfig?.hosts ?? undefined} metricsByHost={layout.panelConfig?.metrics} monitorsByHost={layout.panelConfig?.monitors} snmpByHost={layout.panelConfig?.snmp} />
        </main>
      ) : (
        <main ref={mainRef} className="min-h-0 flex-1 overflow-hidden p-4">
          {tiles.length === 0 ? (
            <p className="p-4 text-slate-500">This wallboard has no widgets yet.</p>
          ) : (
            <div
              className="grid h-full gap-3 [&>*>*]:h-full"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
            >
              {pageTiles.map(({ w, r }) => (
                <div key={w.id} className="min-h-0 min-w-0">
                  <WallTile
                    widget={w}
                    resolved={r}
                    uptimePct={w.kind === "monitor" ? series[w.refId]?.uptimePct : undefined}
                    sparkline={w.kind === "monitor" ? series[w.refId]?.latency : undefined}
                    scale
                  />
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {alerts.length > 0 && (
        <div className="border-t border-slate-800 bg-slate-900/60 px-8 py-3">
          <div className="mb-1 text-xs uppercase tracking-widest text-amber-400">Active alerts</div>
          <ul className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-slate-300">
            {alerts.map((a) => (
              <li key={a.id}>
                <span className={a.severity === "critical" ? "text-rose-400" : "text-amber-300"}>●</span>{" "}
                {a.plainLanguage || a.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {forcedLayoutId && !fullscreen ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-50 flex justify-center">
          <span className="animate-pulse rounded-full bg-slate-800/85 px-4 py-1.5 text-sm text-slate-200 ring-1 ring-slate-600">Click anywhere to go fullscreen</span>
        </div>
      ) : null}

      <TickerBar />
    </div>
  );
}
