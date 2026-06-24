/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Monitor contracts: the single source of truth for monitor types and DTOs
 * exchanged between backend, workers, and frontend.
 */

export const MONITOR_TYPES = ["service", "process", "host", "database", "storage", "ping", "snmp", "http", "tcp", "dns"] as const;
export type MonitorType = (typeof MONITOR_TYPES)[number];

/**
 * Agentless "synthetic" checks the Argus host runs centrally (Uptime-Kuma style) —
 * no agent on the target. Scheduled server-side; results flow through the normal
 * pipeline (events / uptime / live patch).
 */
export const SYNTHETIC_MONITOR_TYPES = ["http", "tcp", "dns"] as const;
export type SyntheticMonitorType = (typeof SYNTHETIC_MONITOR_TYPES)[number];

/** Monitor types the Argus host schedules + runs itself (per-monitor cadence). */
export const SERVER_MONITOR_TYPES = ["ping", "http", "tcp", "dns"] as const;
export type ServerMonitorType = (typeof SERVER_MONITOR_TYPES)[number];

/** Check-interval presets (seconds) offered in the UI. */
export const CHECK_INTERVALS = [
  { label: "5 seconds", sec: 5 },
  { label: "10 seconds", sec: 10 },
  { label: "20 seconds", sec: 20 },
  { label: "30 seconds", sec: 30 },
  { label: "1 minute", sec: 60 },
  { label: "2 minutes", sec: 120 },
  { label: "5 minutes", sec: 300 },
  { label: "10 minutes", sec: 600 },
  { label: "30 minutes", sec: 1800 },
  { label: "1 hour", sec: 3600 },
] as const;

/** Retry-interval presets (seconds). */
export const RETRY_INTERVALS = [
  { label: "5 seconds", sec: 5 },
  { label: "10 seconds", sec: 10 },
  { label: "20 seconds", sec: 20 },
  { label: "30 seconds", sec: 30 },
  { label: "1 minute", sec: 60 },
  { label: "2 minutes", sec: 120 },
] as const;

/** ICMP packet counts (ping only). */
export const PING_COUNTS = [1, 2, 3, 4, 5] as const;

/** Effective per-monitor schedule (all seconds, except count = packets). */
export interface MonitorSchedule {
  intervalSec: number;
  retries: number;
  retryIntervalSec: number;
  count: number; // ICMP packets (ping); ignored by other types
}

/** Built-in defaults per server-run monitor type when config omits them. */
export const DEFAULT_SCHEDULE: Record<string, MonitorSchedule> = {
  ping: { intervalSec: 10, retries: 3, retryIntervalSec: 20, count: 3 },
  http: { intervalSec: 30, retries: 0, retryIntervalSec: 10, count: 1 },
  tcp: { intervalSec: 30, retries: 0, retryIntervalSec: 10, count: 1 },
  dns: { intervalSec: 30, retries: 0, retryIntervalSec: 10, count: 1 },
};

const FALLBACK_SCHEDULE: MonitorSchedule = { intervalSec: 30, retries: 0, retryIntervalSec: 10, count: 1 };

/**
 * Resolve a monitor's effective schedule from its config (`interval`, `retries`,
 * `retryInterval`, `count`), falling back to the per-type defaults. Clamped to sane
 * bounds so a bad value can never produce a hot loop.
 */
export function monitorSchedule(type: string, config: Record<string, unknown> | undefined): MonitorSchedule {
  const d = DEFAULT_SCHEDULE[type] ?? FALLBACK_SCHEDULE;
  const c = config ?? {};
  const posInt = (v: unknown, def: number, min: number, max: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= min ? Math.min(Math.floor(n), max) : def;
  };
  return {
    intervalSec: posInt(c.interval, d.intervalSec, 5, 86_400),
    retries: posInt(c.retries, d.retries, 0, 10),
    retryIntervalSec: posInt(c.retryInterval, d.retryIntervalSec, 1, 3600),
    count: posInt(c.count, d.count, 1, 10),
  };
}

/** Per-monitor wallboard series: recent latency points + rolling 24h uptime %. */
export interface MonitorSeries {
  latency: number[];
  uptimePct: number | null;
}

export interface MonitorDTO {
  id: string;
  agentId: string;
  type: MonitorType;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
