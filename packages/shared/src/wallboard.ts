/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Wallboard, device-registration and ticker contracts. DTOs never expose a
 * device's token hash or pairing code beyond the one-time registration response.
 */

/** A saved wallboard layout as shown in the UI / rendered on a display. */
export interface WallLayoutDTO {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  isSystem: boolean;
  layout: Record<string, unknown>;
  /** Auto-rotation interval (seconds) for the kiosk views; 0 = paused. */
  rotateSec: number;
  /** Rich-wall layout template the kiosk renders this board with. */
  template: WallTemplate;
  /** Rich-wall scoping: how this board renders + which hosts/metrics it shows. */
  panelConfig: WallPanelConfig;
  createdAt: string;
  updatedAt: string;
}

/** Fixed rich-wall layouts (server-controlled per board). */
export const WALL_TEMPLATES = ["flex", "cols2", "cols3", "rows2", "single"] as const;
export type WallTemplate = (typeof WALL_TEMPLATES)[number];

/** Metrics a rich-wall panel can show; per-host selection picks from these. */
export const WALL_PANEL_METRICS = ["services", "databases", "sessions", "clients", "cpu", "ram", "net", "storage"] as const;
export type WallPanelMetric = (typeof WALL_PANEL_METRICS)[number];

/** Per-host storage/SNMP detail selection. Absent arrays = show all of that kind. */
export interface WallSnmpSelection {
  /** Storage share / SNMP volume names to show as capacity bars (absent = all). */
  volumes?: string[];
  /** Custom SNMP OID item labels to show as stats (absent = none — they're opt-in). */
  items?: string[];
  /** Show the disk health/temperature summary (default true when disks exist). */
  disks?: boolean;
}

/** Per-board rich-wall scoping (stored on the layout; configured in the web UI). */
export interface WallPanelConfig {
  /** How the kiosk renders this board. Default board is always "panels". */
  mode?: "panels" | "tiles";
  /** Agent ids to show as panels; null/empty = every host. */
  hosts?: string[] | null;
  /** Optional per-host metric allow-list (agentId → metrics); absent = auto. */
  metrics?: Record<string, WallPanelMetric[]>;
  /** Optional per-host monitor allow-list (agentId → monitor names); absent = all. */
  monitors?: Record<string, string[]>;
  /** Per-host SNMP/storage detail selection (which volumes / OID items / disks show). */
  snmp?: Record<string, WallSnmpSelection>;
  /** Custom header title shown on the wall (falls back to the board name). */
  title?: string;
  /** Header icon key (see the frontend WALL_ICONS map). */
  icon?: string;
}

export const WALL_DEVICE_STATUSES = ["pending", "approved", "revoked"] as const;
export type WallDeviceStatus = (typeof WALL_DEVICE_STATUSES)[number];

/** A registered display device — never includes its token hash or pairing code. */
export interface WallDeviceDTO {
  id: string;
  name: string;
  status: WallDeviceStatus;
  /** 6-digit pairing code — exposed only while pending (to match the on-screen code). */
  pairingCode: string | null;
  /** Per-device board override (takes precedence over the group's board). */
  layoutId: string | null;
  /** Device group this display belongs to (inherits the group's board). */
  groupId: string | null;
  /** Resolved board the device should show: layoutId ?? group.layoutId. */
  effectiveLayoutId: string | null;
  /** True when the display has checked in recently (its /wall page is actually open). */
  online: boolean;
  lastSeenAt: string | null;
  approvedAt: string | null;
  createdAt: string;
}

/** A group of displays that share an assigned wallboard (e.g. "NOC", "Lobby"). */
export interface WallDeviceGroupDTO {
  id: string;
  name: string;
  layoutId: string | null;
  createdAt: string;
}

export const TICKER_SEVERITIES = ["info", "warning", "critical"] as const;
export type TickerSeverity = (typeof TICKER_SEVERITIES)[number];

/** Ticker scroll speed (pixels/second) — a global setting, so it's consistent
 * regardless of how long the messages are. Delivered with /api/ticker/active. */
export const TICKER_SPEED_KEY = "ticker.speed";
export const TICKER_SPEED_DEFAULT = 90;
export const TICKER_SPEED_MIN = 20;
export const TICKER_SPEED_MAX = 400;
export const TICKER_SPEEDS = [
  { label: "Slow", px: 45 },
  { label: "Normal", px: 90 },
  { label: "Fast", px: 160 },
  { label: "Very fast", px: 240 },
] as const;

/** A scrolling ticker message. */
export interface TickerMessageDTO {
  id: string;
  text: string;
  enabled: boolean;
  severity: TickerSeverity;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  /** Wall device-groups that show this on screens. Empty = all walls. */
  deviceGroupIds: string[];
  /** User-groups that see this in the operator UI. Empty = all users. */
  userGroupIds: string[];
  createdAt: string;
}

/** Returned once when a device self-registers — carries its pairing code. */
export interface DeviceRegisterResponse {
  deviceId: string;
  pairingCode: string;
  status: "pending";
}

/** Settings key + options for how long a paired display stays connected before it must
 *  re-pair (sliding window from its last check-in). Global — applies to all devices. */
export const DEVICE_SESSION_TTL_KEY = "deviceSessionTtlSec";
export const DEVICE_SESSION_TTL_DEFAULT = 2_592_000; // 30 days
export const DEVICE_SESSION_TTLS = [
  { label: "1 minute", sec: 60 },
  { label: "24 hours", sec: 86_400 },
  { label: "1 week", sec: 604_800 },
  { label: "1 month", sec: 2_592_000 },
  { label: "3 months", sec: 7_776_000 },
  { label: "6 months", sec: 15_552_000 },
  { label: "1 year", sec: 31_536_000 },
] as const;
