/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Fetches per-monitor wallboard series (latency sparkline + 24h uptime %) for a set
 * of monitor ids and refreshes on an interval. Returned as a lookup the tile reads.
 * Status stays live over the socket; this only backs the slow-moving graphs.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { MonitorSeries } from "@argus/shared";
import { api } from "@/lib/api";

const REFRESH_MS = 30_000;

export function useTileSeries(monitorIds: string[]): Record<string, MonitorSeries> {
  const [series, setSeries] = useState<Record<string, MonitorSeries>>({});
  // Stable key so the effect only re-subscribes when the actual id set changes.
  const key = useMemo(() => [...monitorIds].sort().join(","), [monitorIds]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!key) {
      setSeries({});
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get<{ series: Record<string, MonitorSeries> }>(`/api/monitors/series?ids=${encodeURIComponent(key)}`);
        if (!cancelled) setSeries(res.series);
      } catch {
        /* leave the last-known series in place on a transient failure */
      }
    };
    void load();
    timer.current = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, [key]);

  return series;
}
