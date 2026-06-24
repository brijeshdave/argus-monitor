/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Reachability/latency history for a ping monitor (the must-have host/device ping),
 * with the shared period selector. Charts round-trip latency over the window; gaps
 * (null latency) mark unreachable samples.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { MetricChart } from "@/components/MetricChart";

interface PingPoint { ts: string; up: boolean; latencyMs: number | null }

export function PingHistory({ monitorId, name }: { monitorId: string; name: string }) {
  const [period, setPeriod] = useState("hours=24");
  const [points, setPoints] = useState<PingPoint[]>([]);
  useEffect(() => {
    let cancelled = false;
    void api.get<{ points: PingPoint[] }>(`/api/monitors/${monitorId}/ping-samples?${period}`)
      .then((r) => !cancelled && setPoints(r.points), () => {});
    return () => { cancelled = true; };
  }, [monitorId, period]);

  const data = points.map((p) => ({ t: new Date(p.ts).getTime(), latency: p.latencyMs ?? 0 }));

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <MetricChart
        title={`Reachability — ${name} (latency ms)`}
        data={data}
        lines={[{ key: "latency", label: "Latency ms", color: "#38bdf8" }]}
        period={period}
        onPeriod={setPeriod}
        unit="ms"
        height={150}
      />
    </div>
  );
}
