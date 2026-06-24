/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Event derivation — diffs previous vs current state and produces durable
 * event records.  Pure functions; no I/O, no side effects.
 *
 * Three concerns live here:
 *   1. `diffStates`   — derive STATUS_CHANGE and SERVICE_RESTART events from
 *                       successive telemetry snapshots.
 *   2. `diffClients`  — derive CLIENT_CONNECT / CLIENT_DISCONNECT events from
 *                       successive connected-client sets.
 *   3. `isStale`      — predicate for detecting entities whose last sample is
 *                       too old and should be marked as unreachable.
 */

import type { HealthStatus } from "@argus/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One sample of a monitored unit (service / process) from a telemetry push. */
export interface UnitSample {
  /** Stable identifier — same entity across samples (e.g. "nginx", "postgres"). */
  entity: string;
  status: HealthStatus;
  /**
   * OS process ID.  Present only for process-level monitors.
   * null / undefined means unknown or not applicable.
   */
  pid?: number | null;
}

/**
 * Durable event produced by comparing two successive snapshots.
 * Discriminated on `type` so callers can switch exhaustively.
 */
export type DerivedEvent =
  | {
      type: "STATUS_CHANGE";
      entity: string;
      /** null when the entity is brand-new (first time we see it). */
      oldStatus: HealthStatus | null;
      newStatus: HealthStatus;
    }
  | {
      type: "SERVICE_RESTART";
      entity: string;
      oldPid: number | null;
      newPid: number;
    };

// ---------------------------------------------------------------------------
// diffStates
// ---------------------------------------------------------------------------

/**
 * Compares a previous snapshot (keyed map) to the current list of samples and
 * returns the durable events that need to be persisted.
 *
 * Rules (applied per entity in current array order):
 *  - Entity is new OR its status changed → emit STATUS_CHANGE
 *    (oldStatus is null for brand-new entities).
 *  - Both old and new samples carry pid > 0, and the pids differ → emit
 *    SERVICE_RESTART (the OS replaced the process).
 *  - If the entity is unchanged (same status, same/absent pid) → no event.
 *
 * Ordering: for the same entity, STATUS_CHANGE is emitted before
 * SERVICE_RESTART, matching the array order of current samples.
 */
export function diffStates(
  prev: ReadonlyMap<string, UnitSample>,
  current: readonly UnitSample[],
): DerivedEvent[] {
  const events: DerivedEvent[] = [];

  for (const sample of current) {
    const old = prev.get(sample.entity);

    const isNew = old === undefined;
    const statusChanged = !isNew && old.status !== sample.status;

    if (isNew || statusChanged) {
      events.push({
        type: "STATUS_CHANGE",
        entity: sample.entity,
        oldStatus: isNew ? null : old.status,
        newStatus: sample.status,
      });
    }

    // A restart is only meaningful when BOTH sides have real (> 0) pids.
    const oldPid = old?.pid ?? null;
    const newPid = sample.pid ?? null;

    const pidReplaced =
      oldPid !== null &&
      oldPid > 0 &&
      newPid !== null &&
      newPid > 0 &&
      oldPid !== newPid;

    if (pidReplaced) {
      events.push({
        type: "SERVICE_RESTART",
        entity: sample.entity,
        // newPid is guaranteed > 0 here; oldPid is a positive number too.
        oldPid,
        // TypeScript narrowing: we checked newPid > 0 above.
        newPid: newPid as number,
      });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// diffClients
// ---------------------------------------------------------------------------

/**
 * Derives CLIENT_CONNECT / CLIENT_DISCONNECT events by comparing two sets of
 * connected-client identifiers.
 *
 * - In `current` but not `prev` → CLIENT_CONNECT
 * - In `prev` but not `current` → CLIENT_DISCONNECT
 *
 * No ordering guarantee across connect/disconnect events (Set iteration order).
 */
export function diffClients(
  prev: ReadonlySet<string>,
  current: ReadonlySet<string>,
): Array<{ type: "CLIENT_CONNECT" | "CLIENT_DISCONNECT"; client: string }> {
  const events: Array<{
    type: "CLIENT_CONNECT" | "CLIENT_DISCONNECT";
    client: string;
  }> = [];

  for (const client of current) {
    if (!prev.has(client)) {
      events.push({ type: "CLIENT_CONNECT", client });
    }
  }

  for (const client of prev) {
    if (!current.has(client)) {
      events.push({ type: "CLIENT_DISCONNECT", client });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// isStale
// ---------------------------------------------------------------------------

/**
 * Returns true when the last-seen timestamp is older than `thresholdSec`
 * relative to `now`.  Use this to mark entities as unreachable when the agent
 * stops sending telemetry.
 *
 * @param lastSeenIso  ISO-8601 UTC string of the last received sample.
 * @param now          Current epoch milliseconds (Date.now() in production,
 *                     a fixed value in tests).
 * @param thresholdSec Number of seconds after which a sample is stale.
 */
export function isStale(
  lastSeenIso: string,
  now: number,
  thresholdSec: number,
): boolean {
  const lastSeenMs = Date.parse(lastSeenIso);
  // If the timestamp cannot be parsed, treat as stale for safety.
  if (Number.isNaN(lastSeenMs)) return true;
  return now - lastSeenMs > thresholdSec * 1_000;
}
