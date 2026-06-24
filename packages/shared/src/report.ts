/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Report contracts. Reports are generated on demand, can be previewed/exported in
 * the UI (CSV / PDF / JSON) and optionally saved as JSON snapshots on disk, then
 * listed, re-opened and downloaded. The look-back window can be a rolling number
 * of days OR an explicit custom date range. The file's `data` payload is
 * type-specific (rendered as tables + charts on the client).
 */

/** The kinds of report Argus can generate. */
export const REPORT_TYPES = ["summary", "uptime", "incidents", "resource", "storage", "storage-detail", "inventory"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** Human labels for the report types (UI). */
export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  summary: "Executive summary",
  uptime: "Uptime / availability",
  incidents: "Incidents",
  resource: "Resource usage (CPU / RAM)",
  storage: "Storage capacity",
  "storage-detail": "Storage (detailed + folders)",
  inventory: "Inventory",
};

/** Metadata describing one saved report file on disk (for the list view). */
export interface ReportMeta {
  name: string;
  type: ReportType;
  createdAt: string;
  size: number;
  /** Human-readable scope (e.g. "All monitors", "Agent: web-01"). Best-effort. */
  scopeLabel?: string;
  /** The window the report covered, as a friendly string (e.g. "Last 30 days"). */
  windowLabel?: string;
}

/**
 * Request body to generate/preview a report.
 * Window precedence: if `from` (and optionally `to`) are set, the explicit range
 * is used; otherwise the rolling `days` window applies (default 30).
 */
export interface ReportRequest {
  type: ReportType;
  scope: { kind: "all" | "agent" | "monitor"; refId?: string };
  /** Rolling look-back window in days (used when no explicit range is given). */
  days?: number;
  /** Inclusive start of an explicit custom range (ISO-8601). */
  from?: string;
  /** Inclusive end of an explicit custom range (ISO-8601); defaults to "now". */
  to?: string;
}
