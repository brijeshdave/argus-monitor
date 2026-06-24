/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Public status-page contracts. The PUBLIC status DTO is secure-by-construction:
 * it carries ONLY coarse, whitelisted fields (human labels, health statuses, an
 * optional uptime percentage and a coarse daily-uptime history). It NEVER exposes
 * ids, hostnames, ips or config. The admin config DTO is operator-facing and may
 * reference agents/monitors by id.
 */
import type { HealthStatus } from "./common.js";

/** A single entry an operator pins to the public status page. */
export interface PublicItemConfig {
  kind: "agent" | "monitor";
  /** Internal reference (agent id or monitor id). Operator-only; never public. */
  refId: string;
  /** Human-friendly display label shown on the public page. */
  label: string;
  /**
   * Optional custom group/section name. Items sharing a group are rendered under
   * one heading (with its own rolled-up status). Blank → the default section.
   */
  group?: string;
}

/** Severity of an operator-posted public banner. */
export const PUBLIC_NOTICE_LEVELS = ["info", "maintenance", "incident"] as const;
export type PublicNoticeLevel = (typeof PUBLIC_NOTICE_LEVELS)[number];

/** An operator-posted banner (incident / scheduled maintenance / info). */
export interface PublicNotice {
  level: PublicNoticeLevel;
  message: string;
}

/** Operator-facing configuration of the public status page (admin only). */
export interface PublicConfigDTO {
  enabled: boolean;
  title: string;
  /** Optional subtitle/blurb shown under the title on the public page. */
  description?: string;
  showUptime: boolean;
  /** Show a coarse per-item daily-uptime history sparkline. */
  showHistory: boolean;
  /** Window (in days) for the history sparkline. */
  historyDays: number;
  /** Optional banner pinned atop the page; blank message = no banner. */
  notice?: PublicNotice;
  items: PublicItemConfig[];
}

/** Allowed history windows offered in the admin UI. */
export const PUBLIC_HISTORY_DAYS = [30, 60, 90] as const;

/**
 * A single coarse line item on the PUBLIC status page.
 * NOTE: intentionally carries no ids/hostnames — label + status (+ optional
 * uptime / coarse history) only.
 */
export interface PublicStatusItem {
  label: string;
  status: HealthStatus;
  uptimePct?: number;
  /**
   * Coarse daily uptime percentages, oldest→newest, one entry per day in the
   * configured window. `null` marks a day with no recorded data.
   */
  history?: Array<number | null>;
}

/** A named section grouping related items, with its own rolled-up status. */
export interface PublicStatusGroup {
  /** Section heading. Empty string = the default/ungrouped section. */
  name: string;
  status: HealthStatus;
  items: PublicStatusItem[];
}

/** The full PUBLIC status payload served to unauthenticated visitors. */
export interface PublicStatusDTO {
  title: string;
  description?: string;
  /** Operator-posted banner (incident / maintenance / info), when set. */
  notice?: PublicNotice;
  overall: HealthStatus;
  groups: PublicStatusGroup[];
  /** ISO-8601 UTC timestamp of when this snapshot was generated. */
  generatedAt: string;
}
