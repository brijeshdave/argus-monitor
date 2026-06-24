/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Live-state hook: opens an authenticated WebSocket to `WS /ws` (proxied to the
 * backend in dev), applies the initial `snapshot` then merges incremental
 * `patch` messages. Exposes connection status, the live agent list and a
 * per-unit lookup so components can render without polling. Reconnects with a
 * short backoff and tears down on unmount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveAgent, LiveLogLine, LiveMessage, LiveUnit } from "@argus/shared";
import { getAccess } from "@/lib/tokens";

/** Most recent live log lines retained per agent (bounded ring). */
const MAX_LOG_LINES = 200;

/** Composite map key for a unit. */
function unitKey(sourceId: string, entity: string): string {
  return `${sourceId}:${entity}`;
}

interface UseLiveState {
  connected: boolean;
  agents: LiveAgent[];
  units: LiveUnit[];
  unitFor: (sourceId: string, entity: string) => LiveUnit | undefined;
  logsFor: (agentId: string) => LiveLogLine[];
}

export function useLiveState(): UseLiveState {
  const [connected, setConnected] = useState(false);
  const [agents, setAgents] = useState<LiveAgent[]>([]);
  const [unitMap, setUnitMap] = useState<Map<string, LiveUnit>>(() => new Map());
  const [logMap, setLogMap] = useState<Map<string, LiveLogLine[]>>(() => new Map());

  // Refs hold the live socket + reconnect timer so cleanup is reliable.
  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);

  const apply = useCallback((msg: LiveMessage) => {
    if (msg.t === "snapshot") {
      setAgents(msg.agents);
      setUnitMap(new Map(msg.units.map((u) => [unitKey(u.sourceId, u.entity), u])));
    } else if (msg.t === "patch") {
      setUnitMap((prev) => {
        const next = new Map(prev);
        for (const u of msg.units) {
          const key = unitKey(u.sourceId, u.entity);
          const existing = next.get(key);
          // Preserve "since" while the status is unchanged so tiles can show how long
          // a unit has held its state; reset it the moment the status flips.
          const since =
            existing && existing.status === u.status
              ? existing.since
              : (u.since ?? new Date().toISOString());
          next.set(key, { ...u, since });
        }
        return next;
      });
    } else if (msg.t === "agent") {
      // Partial agent patch: shallow-merge provided fields so a metrics-only patch
      // doesn't clobber connectivity (and vice versa).
      setAgents((prev) => {
        const byId = new Map(prev.map((a) => [a.id, a]));
        for (const a of msg.agents) {
          const existing = byId.get(a.id);
          byId.set(a.id, existing
            ? { ...existing, ...a }
            : { name: a.id, status: "unknown", online: false, lastSeenAt: null, ...a });
        }
        return [...byId.values()];
      });
    } else {
      // Live log batch: append to the agent's bounded ring (keep last N).
      setLogMap((prev) => {
        const next = new Map(prev);
        const merged = [...(next.get(msg.agentId) ?? []), ...msg.lines];
        next.set(msg.agentId, merged.slice(-MAX_LOG_LINES));
        return next;
      });
    }
  }, []);

  const connect = useCallback(() => {
    const token = getAccess();
    if (!token || closedRef.current) return;

    const url = `${location.origin.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    socketRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onmessage = (ev) => {
      try {
        apply(JSON.parse(ev.data as string) as LiveMessage);
      } catch {
        // Ignore malformed frames — the server only ever sends valid LiveMessage JSON.
      }
    };
    const scheduleReconnect = () => {
      setConnected(false);
      socketRef.current = null;
      if (closedRef.current) return;
      timerRef.current = setTimeout(connect, 2000);
    };
    ws.onclose = scheduleReconnect;
    ws.onerror = () => ws.close();
  }, [apply]);

  useEffect(() => {
    closedRef.current = false;
    connect();
    return () => {
      closedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [connect]);

  const unitFor = useCallback(
    (sourceId: string, entity: string) => unitMap.get(unitKey(sourceId, entity)),
    [unitMap],
  );

  const logsFor = useCallback((agentId: string) => logMap.get(agentId) ?? [], [logMap]);

  return { connected, agents, units: [...unitMap.values()], unitFor, logsFor };
}
