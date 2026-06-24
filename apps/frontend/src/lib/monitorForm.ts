/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Shared structured-config helpers for the credentialed monitor types (storage,
 * database, snmp) so create and edit render the SAME fields — no raw JSON, no
 * escaping. Secret fields (password/community) are write-only: blank on edit means
 * "keep existing".
 */
import { monitorSchedule } from "@argus/shared";

/** One watched folder with its own scan depth + schedule (interval or daily times). */
export interface WatchFolderRow {
  path: string;
  depth: number;
  refreshMin: number; // canonical interval in minutes
  refreshUnit: "minutes" | "hours"; // display unit only (config is always minutes)
  scanTimes: string[]; // "HH:MM" daily times (any number); non-empty overrides interval
  scanTZ: string;    // IANA timezone for scanTimes (e.g. "Asia/Kolkata"); "" = agent local
}

export interface MonitorFieldValues {
  // storage
  path: string;
  server: boolean; // probe from the Argus host via SMB (no agent) — e.g. for a device
  folders: boolean; // collect top-level folder sizes
  watchFolders: WatchFolderRow[]; // specific subfolders, each with own depth + period
  // shared
  user: string;
  password: string;
  // database
  host: string;
  port: string;
  database: string;
  encrypt: boolean;
  collectQueries: boolean;
  topN: number;
  // snmp
  community: string;
  snmpVersion: string;
  oids: string; // legacy: one "Label = OID" per line (pre-profile monitors)
  profileId: string; // chosen SNMP profile (the "MIB master")
  // synthetic checks (http / tcp / dns) — run centrally from the Argus host
  url: string;
  method: string;
  expectedStatus: string; // "" = any 2xx/3xx; else codes/ranges e.g. "200,301,500-599"
  keyword: string; // optional body substring (http)
  recordType: string; // dns record type (A/AAAA/CNAME/MX/TXT/NS)
  resolver: string; // optional custom DNS server (dns)
  // schedule (server-run types: ping/http/tcp/dns)
  interval: number; // check interval (seconds)
  retries: number; // retries before recording DOWN
  retryInterval: number; // seconds between retries
  count: number; // ICMP packets (ping)
}

export function emptyValues(): MonitorFieldValues {
  return { path: "", server: false, folders: false, watchFolders: [], user: "", password: "", host: "", port: "", database: "", encrypt: false, collectQueries: false, topN: 10, community: "", snmpVersion: "2c", oids: "", profileId: "", url: "", method: "GET", expectedStatus: "", keyword: "", recordType: "A", resolver: "", interval: 30, retries: 0, retryInterval: 10, count: 3 };
}

/** Parse the OID textarea ("Label = 1.3.6…" per line) into [{label, oid}]. */
function parseOidLines(text: string): Array<{ label: string; oid: string }> {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const eq = l.indexOf("=");
      if (eq === -1) return { label: l, oid: l };
      return { label: l.slice(0, eq).trim(), oid: l.slice(eq + 1).trim() };
    })
    .filter((o) => o.oid);
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Prefill values from a stored monitor config (password stays blank — it's secret). */
export function valuesFromConfig(type: string, config: Record<string, unknown> | undefined): MonitorFieldValues {
  const c = config ?? {};
  const v = emptyValues();
  if (type === "storage") {
    v.path = str(c.path);
    v.user = str(c.user);
    v.server = c.server === true;
    v.folders = c.folders === true;
    v.watchFolders = Array.isArray(c.watchFolders)
      ? (c.watchFolders as unknown[]).map((w) => {
          if (typeof w === "string") return { path: w, depth: 1, refreshMin: 15, refreshUnit: "minutes" as const, scanTimes: [], scanTZ: "" };
          const o = (w ?? {}) as Record<string, unknown>;
          const times = Array.isArray(o.scanTimes) ? (o.scanTimes as unknown[]).map(String) : (typeof o.dailyAt === "string" && o.dailyAt ? [o.dailyAt] : []);
          const rm = typeof o.refreshMin === "number" ? o.refreshMin : 15;
          return { path: String(o.path ?? ""), depth: typeof o.depth === "number" ? o.depth : 1, refreshMin: rm, refreshUnit: (rm >= 60 && rm % 60 === 0 ? "hours" : "minutes") as "minutes" | "hours", scanTimes: times, scanTZ: typeof o.scanTimezone === "string" ? o.scanTimezone : "" };
        }).filter((r) => r.path)
      : [];
  } else if (type === "database") {
    v.host = str(c.host);
    v.port = c.port != null ? String(c.port) : "";
    v.database = str(c.database);
    v.user = str(c.user);
    v.encrypt = c.encrypt === true;
    v.collectQueries = c.collectQueries === true;
    v.topN = typeof c.topN === "number" ? c.topN : 10;
  } else if (type === "snmp") {
    v.host = str(c.host);
    v.snmpVersion = str(c.version) || "2c";
    v.profileId = str(c.profileId);
    const oids = Array.isArray(c.oids) ? (c.oids as Array<{ label?: unknown; oid?: unknown }>) : [];
    v.oids = oids.map((o) => `${String(o.label ?? o.oid ?? "")} = ${String(o.oid ?? "")}`).join("\n");
  } else if (type === "http") {
    v.url = str(c.url);
    v.method = str(c.method) || "GET";
    v.expectedStatus = c.expectedStatus != null ? String(c.expectedStatus) : "";
    v.keyword = str(c.keyword);
  } else if (type === "tcp") {
    v.host = str(c.host);
    v.port = c.port != null ? String(c.port) : "";
  } else if (type === "dns") {
    v.host = str(c.host);
    v.recordType = str(c.recordType) || "A";
    v.resolver = str(c.resolver);
  } else if (type === "ping") {
    v.host = str(c.host);
    v.port = c.port != null ? String(c.port) : "";
  }
  // Server-run types carry a per-monitor schedule (falls back to per-type defaults).
  if (type === "ping" || type === "http" || type === "tcp" || type === "dns") {
    const s = monitorSchedule(type, c);
    v.interval = s.intervalSec;
    v.retries = s.retries;
    v.retryInterval = s.retryIntervalSec;
    v.count = s.count;
  }
  return v;
}

/** Build the config object to send. Omits a blank password so edits keep the stored one. */
export function buildConfig(type: string, v: MonitorFieldValues): Record<string, unknown> {
  if (type === "storage") {
    const cfg: Record<string, unknown> = { path: v.path.trim(), folders: v.folders };
    if (v.server) cfg.server = true;
    if (v.user.trim()) cfg.user = v.user.trim();
    if (v.password) cfg.password = v.password;
    const watch = v.watchFolders
      .filter((r) => r.path.trim())
      // depth 0 = unlimited (honored by a local NAS agent; SMB probes cap it internally).
      .map((r) => {
        const row: Record<string, unknown> = { path: r.path.trim(), depth: r.depth === 0 ? 0 : Math.max(1, Math.min(50, Number(r.depth) || 1)) };
        const times = r.scanTimes.map((t) => t.trim()).filter((t) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t));
        if (times.length) { row.scanTimes = times; if (r.scanTZ.trim()) row.scanTimezone = r.scanTZ.trim(); }
        else row.refreshMin = Math.max(1, Number(r.refreshMin) || 15);
        return row;
      });
    if (watch.length) cfg.watchFolders = watch;
    return cfg;
  }
  if (type === "snmp") {
    const cfg: Record<string, unknown> = { host: v.host.trim(), version: v.snmpVersion };
    if (v.profileId) cfg.profileId = v.profileId;
    if (v.community) cfg.community = v.community;
    return cfg;
  }
  // Common per-monitor schedule for server-run types.
  const schedule = { interval: v.interval, retries: v.retries, retryInterval: v.retryInterval };
  if (type === "http") {
    const cfg: Record<string, unknown> = { url: v.url.trim(), method: v.method || "GET", ...schedule };
    if (v.expectedStatus.trim()) cfg.expectedStatus = v.expectedStatus.trim();
    if (v.keyword.trim()) cfg.keyword = v.keyword;
    return cfg;
  }
  if (type === "tcp") {
    const cfg: Record<string, unknown> = { host: v.host.trim(), ...schedule };
    if (v.port.trim()) cfg.port = Number(v.port);
    return cfg;
  }
  if (type === "dns") {
    const cfg: Record<string, unknown> = { host: v.host.trim(), recordType: v.recordType || "A", ...schedule };
    if (v.resolver.trim()) cfg.resolver = v.resolver.trim();
    return cfg;
  }
  if (type === "ping") {
    // host blank → the scheduler falls back to the device's address.
    const cfg: Record<string, unknown> = { ...schedule, count: v.count };
    if (v.host.trim()) cfg.host = v.host.trim();
    if (v.port.trim()) cfg.port = Number(v.port);
    return cfg;
  }
  // database
  const cfg: Record<string, unknown> = { host: v.host.trim(), encrypt: v.encrypt, collectQueries: v.collectQueries };
  if (v.port.trim()) cfg.port = Number(v.port);
  if (v.database.trim()) cfg.database = v.database.trim();
  if (v.user.trim()) cfg.user = v.user.trim();
  if (v.password) cfg.password = v.password;
  if (v.collectQueries) cfg.topN = v.topN;
  return cfg;
}

/** Client-side required-field check; returns an error string or null. */
export function validate(type: string, v: MonitorFieldValues): string | null {
  if (type === "storage" && !v.path.trim()) return "Share path is required (e.g. \\\\nas\\share).";
  if (type === "database" && !v.host.trim()) return "Database host is required.";
  if (type === "snmp" && !v.host.trim()) return "Device host/IP is required.";
  if (type === "http" && !/^https?:\/\//i.test(v.url.trim())) return "A URL starting with http:// or https:// is required.";
  if (type === "tcp" && (!v.host.trim() || !v.port.trim())) return "Host and port are required.";
  if (type === "dns" && !v.host.trim()) return "Hostname is required.";
  return null;
}
