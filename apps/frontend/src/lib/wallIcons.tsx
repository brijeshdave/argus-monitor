/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Wallboard header icons — a small curated set an operator can pick from for a board's
 * title (stored as a key in WallPanelConfig.icon). Shared by the kiosk + Display dialog.
 */
import { Activity, Building2, Gauge, Globe, LayoutDashboard, MonitorPlay, Network, ServerCog, type LucideIcon } from "lucide-react";

export const WALL_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  monitor: MonitorPlay,
  activity: Activity,
  server: ServerCog,
  gauge: Gauge,
  network: Network,
  building: Building2,
  globe: Globe,
};

export const WALL_ICON_NAMES = Object.keys(WALL_ICONS);
