/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Overall health rollup — derives a single HealthStatus from a collection of
 * monitored units.  Pure function; no I/O, no side effects.
 *
 * Rollup invariant (project spec):
 *   - Any critical unit DOWN or HANG  → "DOWN"
 *   - Else any non-critical unit DOWN or HANG → "DEGRADED"
 *   - Else every unit UP              → "UP"
 *   - Empty list or any UNKNOWN/mix   → "UNKNOWN"
 */

import type { HealthStatus } from "@argus/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single monitored item contributing to the overall rollup.
 * `critical` means an outage here escalates the whole entity to DOWN rather
 * than DEGRADED.
 */
export interface Unit {
  status: HealthStatus;
  /** When true, a DOWN/HANG status here forces the rollup to DOWN. */
  critical: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** DOWN and HANG are the two "bad" statuses that can pull down the rollup. */
function isBad(status: HealthStatus): boolean {
  return status === "DOWN" || status === "HANG";
}

// ---------------------------------------------------------------------------
// Rollup
// ---------------------------------------------------------------------------

/**
 * Derives the coarsest health status across all units.
 *
 * Decision order (short-circuit on first match):
 *  1. Empty list                          → UNKNOWN
 *  2. Any critical unit is DOWN/HANG      → DOWN
 *  3. Any non-critical unit is DOWN/HANG  → DEGRADED
 *  4. All units are UP                    → UP
 *  5. Otherwise (mix of UP + UNKNOWN, etc.) → UNKNOWN
 */
export function rollup(units: readonly Unit[]): HealthStatus {
  if (units.length === 0) return "UNKNOWN";

  for (const unit of units) {
    if (unit.critical && isBad(unit.status)) return "DOWN";
  }

  for (const unit of units) {
    if (!unit.critical && isBad(unit.status)) return "DEGRADED";
  }

  // All units must be UP for a clean UP result.
  if (units.every((u) => u.status === "UP")) return "UP";

  // Mixed UP/UNKNOWN (or other non-bad statuses) without any bad unit.
  return "UNKNOWN";
}
