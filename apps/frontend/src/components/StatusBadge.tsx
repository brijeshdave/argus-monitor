/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Status pill in the SCADA style: a (pulsing) status LED + a tinted, ringed
 * label. Health and agent-lifecycle statuses map onto the semantic palette; the
 * LED pulses for fault states (down/hang) to draw the eye on a wallboard.
 */

type Tone = "up" | "degraded" | "hang" | "down" | "unknown";

/** Map every status string to a semantic tone. */
const TONE: Record<string, Tone> = {
  // health
  up: "up",
  degraded: "degraded",
  hang: "hang",
  down: "down",
  unknown: "unknown",
  // agent / key lifecycle + connectivity
  approved: "up",
  online: "up",
  revoked: "down",
  offline: "unknown",
  pending: "hang",
};

const PILL: Record<Tone, string> = {
  up: "bg-status-up/10 text-status-up ring-status-up/30",
  degraded: "bg-status-degraded/10 text-status-degraded ring-status-degraded/30",
  hang: "bg-status-hang/10 text-status-hang ring-status-hang/30",
  down: "bg-status-down/10 text-status-down ring-status-down/30",
  unknown: "bg-status-unknown/10 text-status-unknown ring-status-unknown/30",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = TONE[status.toLowerCase()] ?? "unknown";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide ring-1 ${PILL[tone]}`}
    >
      <span className={`status-led status-led--${tone}`} aria-hidden />
      {status}
    </span>
  );
}
