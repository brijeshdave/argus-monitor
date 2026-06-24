/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Wallboard widget contracts + the entities feed that backs tile status. The
 * layout JSON is freeform; this is our agreed shape. Builder & kiosk both look up
 * a widget's live-ish status by matching its refId against agents/monitors, and
 * the kiosk can re-poll the feed on an interval for a near-live TV view.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentDTO, MonitorDTO } from "@argus/shared";
import { api } from "@/lib/api";
import { useLiveState } from "@/hooks/useLiveState";

/** The kind of entity a widget references. */
export type WidgetKind = "agent" | "monitor";

/** Tile size on the board grid. */
export type WidgetSize = "sm" | "lg";

/** Optional per-tile detail rows the operator can toggle on. */
export type WidgetMetric = "latency" | "since" | "uptime";

/** Every metric, in display order — the default when a widget specifies none. */
export const ALL_METRICS: WidgetMetric[] = ["latency", "since", "uptime"];

/** One tile on a wallboard. */
export interface Widget {
  id: string;
  kind: WidgetKind;
  refId: string;
  title?: string;
  size?: WidgetSize;
  /** Optional heading this tile is grouped under on the board. */
  group?: string;
  /** Which detail rows to show; undefined → ALL_METRICS. */
  metrics?: WidgetMetric[];
}

/** The freeform `layout` payload persisted on a WallLayoutDTO. */
export interface WallLayoutShape {
  widgets: Widget[];
}

interface ListResponse<T> {
  rows: T[];
}

/** Narrow an unknown freeform layout into our widget shape, defaulting safely. */
export function readWidgets(layout: Record<string, unknown> | undefined): Widget[] {
  const raw = layout?.widgets;
  if (!Array.isArray(raw)) return [];
  const out: Widget[] = [];
  for (const w of raw) {
    if (typeof w !== "object" || w === null) continue;
    const c = w as Record<string, unknown>;
    if (typeof c.id !== "string" || typeof c.refId !== "string") continue;
    if (c.kind !== "agent" && c.kind !== "monitor") continue;
    const metrics = Array.isArray(c.metrics)
      ? c.metrics.filter((x): x is WidgetMetric => x === "latency" || x === "since" || x === "uptime")
      : undefined;
    out.push({
      id: c.id,
      kind: c.kind,
      refId: c.refId,
      title: typeof c.title === "string" ? c.title : undefined,
      size: c.size === "lg" ? "lg" : c.size === "sm" ? "sm" : undefined,
      group: typeof c.group === "string" && c.group ? c.group : undefined,
      metrics,
    });
  }
  return out;
}

/** Resolved live state for one tile, plus whether its referenced entity exists. */
export interface ResolvedWidget {
  title: string;
  status: string;
  kind: WidgetKind;
  /** Server-side ping latency (ms), when the unit reports it. */
  latencyMs: number | null;
  /** ISO time the unit entered its current status, for a "for 4m" label. */
  since: string | null;
  /** True when the referenced agent/monitor no longer exists (a dangling tile). */
  missing: boolean;
}

export interface WallEntities {
  loading: boolean;
  error: string | null;
  agents: AgentDTO[];
  monitors: MonitorDTO[];
  /** True once the live WebSocket feed is connected. */
  live: boolean;
  /** Resolve a widget's title + StatusBadge-compatible status from LIVE state. */
  resolve: (w: Widget) => ResolvedWidget;
  /** The auto-populated widget set for the immutable default board (all entities). */
  defaultWidgets: () => Widget[];
  reload: () => void;
}

/**
 * Backs wallboard tiles. The agent/monitor LIST (names, existence) is loaded over
 * REST; tile STATUS is driven by the live WebSocket so a kiosk stays current with
 * no refresh ("set up once and forget"). `pollMs` only re-pulls the entity list so
 * added/removed entities eventually surface — status never needs it.
 */
export function useWallEntities(pollMs?: number): WallEntities {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [monitors, setMonitors] = useState<MonitorDTO[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { connected, agents: liveAgents, unitFor } = useLiveState();

  const load = useCallback(async () => {
    try {
      const [a, m] = await Promise.all([
        api.get<ListResponse<AgentDTO>>("/api/agents"),
        api.get<ListResponse<MonitorDTO>>("/api/monitors"),
      ]);
      setAgents(a.rows);
      setMonitors(m.rows);
      setError(null);
    } catch {
      setError("Failed to load wallboard entities.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    if (pollMs && pollMs > 0) {
      timer.current = setInterval(() => void load(), pollMs);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load, pollMs]);

  const resolve = useMemo(() => {
    const agentMap = new Map(agents.map((a) => [a.id, a]));
    const monitorMap = new Map(monitors.map((m) => [m.id, m]));
    const onlineById = new Map(liveAgents.map((a) => [a.id, a.online]));
    return (w: Widget): ResolvedWidget => {
      if (w.kind === "agent") {
        const a = agentMap.get(w.refId);
        if (!a) return { title: w.title ?? w.refId, status: "UNKNOWN", kind: "agent", latencyMs: null, since: null, missing: true };
        const online = onlineById.get(a.id) ?? a.online;
        return { title: w.title ?? a.name, status: online ? "UP" : "DOWN", kind: "agent", latencyMs: null, since: a.lastSeenAt, missing: false };
      }
      const m = monitorMap.get(w.refId);
      if (!m) return { title: w.title ?? w.refId, status: "UNKNOWN", kind: "monitor", latencyMs: null, since: null, missing: true };
      // Live units are keyed by (agentId, monitor name); fall back to UNKNOWN until
      // the first sample arrives, or DOWN if the monitor is disabled.
      const unit = unitFor(m.agentId, m.name);
      const status = unit?.status ?? (m.enabled ? "UNKNOWN" : "DOWN");
      return { title: w.title ?? m.name, status, kind: "monitor", latencyMs: unit?.latencyMs ?? null, since: unit?.since ?? null, missing: false };
    };
  }, [agents, monitors, liveAgents, unitFor]);

  // The immutable default board renders the WHOLE fleet automatically: every
  // monitor grouped under its agent, so it always reflects what exists with no
  // editing ("set up once and forget" — the default).
  const defaultWidgets = useMemo(() => {
    const agentName = new Map(agents.map((a) => [a.id, a.name]));
    return (): Widget[] => {
      const ws: Widget[] = [];
      for (const a of agents) ws.push({ id: `def_a_${a.id}`, kind: "agent", refId: a.id, group: a.name, size: "lg" });
      for (const m of monitors) ws.push({ id: `def_m_${m.id}`, kind: "monitor", refId: m.id, group: agentName.get(m.agentId) ?? "Monitors" });
      return ws;
    };
  }, [agents, monitors]);

  return { loading, error, agents, monitors, live: connected, resolve, defaultWidgets, reload: () => void load() };
}
