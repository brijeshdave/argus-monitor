/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Storage capacity forecasting — pure functions, no I/O. Fits a least-squares line
 * to a share's used-bytes history to estimate the growth rate (bytes/day) and how
 * many days remain until the share is full. Used for NAS "days-to-full" warnings and
 * storage-capacity reports.
 */
import type { StoragePoint, StorageForecast } from "@argus/shared";

const MS_PER_DAY = 86_400_000;

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const dot = (xs: number[], ys: number[]): number => xs.reduce((a, x, i) => a + x * (ys[i] ?? 0), 0);

/**
 * Forecast capacity growth from a (time-ordered or unordered) history. Returns null
 * when there isn't enough signal (fewer than two used-bytes samples). `daysToFull`
 * is null unless the share is actually filling (positive slope) and total is known.
 */
export function forecastStorage(points: StoragePoint[]): StorageForecast | null {
  const pts = points
    .filter((p) => typeof p.usedBytes === "number")
    .map((p) => ({ t: Date.parse(p.ts), used: p.usedBytes as number, total: p.totalBytes }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;

  const t0 = pts[0]!.t;
  const xs = pts.map((p) => (p.t - t0) / MS_PER_DAY); // days since first sample
  const ys = pts.map((p) => p.used);
  const n = pts.length;
  const sx = sum(xs);
  const denom = n * dot(xs, xs) - sx * sx;
  // Degenerate (all samples at one instant) → no usable rate.
  const slope = denom === 0 ? 0 : (n * dot(xs, ys) - sx * sum(ys)) / denom; // bytes/day

  const last = pts[n - 1]!;
  const spanDays = xs[n - 1]!;
  let daysToFull: number | null = null;
  let projectedFullDate: string | null = null;
  if (last.total && slope > 0) {
    const remaining = last.total - last.used;
    daysToFull = remaining > 0 ? remaining / slope : 0;
    projectedFullDate = new Date(last.t + daysToFull * MS_PER_DAY).toISOString();
  }

  return { growthBytesPerDay: slope, daysToFull, projectedFullDate, spanDays, samples: n };
}
