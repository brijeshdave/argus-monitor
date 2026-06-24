/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Uptime accumulator — tracks availability over a rolling window.
 * Pure functions; no I/O, no side effects.
 *
 * Design:
 *  - A `UptimeBucket` holds `upSec` and `totalSec` counters.
 *  - `accumulate` adds a time-slice delta, crediting `upSec` only when the
 *    entity was UP during that slice.  It returns a NEW bucket (immutable).
 *  - `uptimePct` converts the bucket to a 0–100 percentage (2 decimal places).
 *
 * Callers accumulate over successive STATUS_CHANGE events:
 *   for each interval between events, call accumulate(bucket, prevStatus, seconds).
 */

import type { HealthStatus } from "@argus/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Accumulates uptime and total elapsed seconds for one entity in one window. */
export interface UptimeBucket {
  /** Seconds the entity was observed as UP within this bucket. */
  upSec: number;
  /** Total observed seconds (including down/degraded/unknown time). */
  totalSec: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Returns a fresh zero-value bucket. */
export function emptyBucket(): UptimeBucket {
  return { upSec: 0, totalSec: 0 };
}

// ---------------------------------------------------------------------------
// Accumulate
// ---------------------------------------------------------------------------

/**
 * Adds `deltaSec` to the bucket's `totalSec`, and to `upSec` only when the
 * entity was UP during that interval.
 *
 * Returns a NEW bucket — the input is never mutated (immutable update pattern).
 *
 * @param b         Current bucket.
 * @param status    Health status that was active for the entire `deltaSec` interval.
 * @param deltaSec  Duration of the interval in seconds.  Negative values are
 *                  clamped to zero (clock skew guard).
 */
export function accumulate(
  b: UptimeBucket,
  status: HealthStatus,
  deltaSec: number,
): UptimeBucket {
  const delta = Math.max(0, deltaSec);
  return {
    upSec: b.upSec + (status === "UP" ? delta : 0),
    totalSec: b.totalSec + delta,
  };
}

// ---------------------------------------------------------------------------
// Percentage
// ---------------------------------------------------------------------------

/**
 * Converts the bucket to an availability percentage in the range 0–100.
 * Returns exactly `0` when `totalSec` is zero (avoids division-by-zero).
 * Rounded to 2 decimal places using standard rounding.
 */
export function uptimePct(b: UptimeBucket): number {
  if (b.totalSec === 0) return 0;
  return Math.round((b.upSec / b.totalSec) * 100 * 100) / 100;
}
