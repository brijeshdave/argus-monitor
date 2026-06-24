/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Categorical badges so log levels, log categories and audit categories/actions
 * each read as distinct colors instead of one uniform pill. Levels use a fixed
 * severity ramp; free-form categories get a stable color picked by hashing the
 * label (same label → same color every time).
 */

const PILL = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ring-1";

/** Severity ramp for log levels. */
const LEVEL: Record<string, string> = {
  trace: "bg-slate-500/10 text-slate-400 ring-slate-500/30",
  debug: "bg-slate-500/10 text-slate-400 ring-slate-500/30",
  info: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  warn: "bg-status-hang/10 text-status-hang ring-status-hang/30",
  warning: "bg-status-hang/10 text-status-hang ring-status-hang/30",
  error: "bg-status-down/10 text-status-down ring-status-down/30",
  fatal: "bg-status-down/20 text-status-down ring-status-down/40",
};

/** Distinct, stable palette for free-form categories (hash-assigned). */
const CATEGORY_TONES = [
  "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  "bg-violet-500/10 text-violet-300 ring-violet-500/30",
  "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  "bg-pink-500/10 text-pink-300 ring-pink-500/30",
  "bg-teal-500/10 text-teal-300 ring-teal-500/30",
  "bg-indigo-500/10 text-indigo-300 ring-indigo-500/30",
  "bg-lime-500/10 text-lime-300 ring-lime-500/30",
];

function hashTone(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return CATEGORY_TONES[Math.abs(h) % CATEGORY_TONES.length]!;
}

export function LevelBadge({ level }: { level: string }) {
  const cls = LEVEL[level.toLowerCase()] ?? "bg-slate-500/10 text-slate-400 ring-slate-500/30";
  return <span className={`${PILL} ${cls}`}>{level}</span>;
}

export function CategoryBadge({ value }: { value: string }) {
  return <span className={`${PILL} ${hashTone(value)}`}>{value}</span>;
}
