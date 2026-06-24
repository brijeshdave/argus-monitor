/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Ticker scheduling — decides which ticker messages are "active" at a given
 * instant based on their enabled flag and optional start/end window. Pure
 * functions; no I/O, so they are cheap to unit-test and reuse across the API,
 * workers and the live broadcast path.
 */

/** The minimal shape needed to decide whether a ticker message should show. */
export interface TickerWindow {
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
}

/**
 * True when a message is enabled and `nowMs` falls inside its window. A null
 * bound means "open-ended" on that side.
 */
export function isTickerActive(w: TickerWindow, nowMs: number): boolean {
  if (!w.enabled) return false;
  if (w.startsAt !== null && nowMs < Date.parse(w.startsAt)) return false;
  if (w.endsAt !== null && nowMs > Date.parse(w.endsAt)) return false;
  return true;
}

/**
 * Filters a list to the currently-active messages, highest priority first.
 * Stable for equal priorities (preserves input order).
 */
export function activeTickers<T extends TickerWindow>(list: readonly T[], nowMs: number): T[] {
  return list
    .filter((w) => isTickerActive(w, nowMs))
    .sort((a, b) => b.priority - a.priority);
}
