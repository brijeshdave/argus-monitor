/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Presentational wallboard tile. Renders a monitored entity's live status plus the
 * operator-selected detail rows (latency, time-in-state, uptime %). Used by both
 * the kiosk (TV view) and the builder; `scale` bumps type sizes for big screens.
 */
import { StatusBadge } from "@/components/StatusBadge";
import { ALL_METRICS, type ResolvedWidget, type Widget } from "@/hooks/useWallEntities";

/** Compact "4m" / "2h 3m" / "3d" label for how long a unit has held its status. */
export function durationSince(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Tiny inline SVG sparkline (no chart lib) for a latency series on a tile. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 100;
  const h = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / span) * h}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-2 h-6 w-full text-sky-400">
      <polyline points={path} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

interface WallTileProps {
  widget: Widget;
  resolved: ResolvedWidget;
  /** Uptime percentage for the "uptime" metric, when known. */
  uptimePct?: number | null;
  /** Recent latency points for the "latency" metric sparkline, when known. */
  sparkline?: number[];
  /** Larger type for kiosk/TV. */
  scale?: boolean;
}

export function WallTile({ widget, resolved, uptimePct, sparkline, scale = false }: WallTileProps) {
  const metrics = widget.metrics ?? ALL_METRICS;
  const dur = durationSince(resolved.since);
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className={`uppercase tracking-widest text-slate-500 ${scale ? "text-xs" : "text-[10px]"}`}>
        {resolved.kind}
      </div>
      <div className={`mt-1 truncate font-medium text-slate-100 ${scale ? "text-lg" : "text-sm"}`}>
        {resolved.title}
      </div>
      <div className={`mt-2 ${scale ? "origin-left scale-110" : ""}`}>
        <StatusBadge status={resolved.status} />
      </div>
      <dl className={`mt-2 space-y-0.5 text-slate-400 ${scale ? "text-sm" : "text-xs"}`}>
        {metrics.includes("latency") && resolved.latencyMs != null ? (
          <div className="flex justify-between gap-3">
            <dt>Latency</dt>
            <dd className="tabular-nums text-slate-300">{resolved.latencyMs.toFixed(0)} ms</dd>
          </div>
        ) : null}
        {metrics.includes("since") && dur ? (
          <div className="flex justify-between gap-3">
            <dt>For</dt>
            <dd className="tabular-nums text-slate-300">{dur}</dd>
          </div>
        ) : null}
        {metrics.includes("uptime") && uptimePct != null ? (
          <div className="flex justify-between gap-3">
            <dt>Uptime</dt>
            <dd className="tabular-nums text-slate-300">{uptimePct.toFixed(1)}%</dd>
          </div>
        ) : null}
      </dl>
      {metrics.includes("latency") && sparkline && sparkline.length >= 2 ? (
        <Sparkline points={sparkline} />
      ) : null}
    </div>
  );
}
