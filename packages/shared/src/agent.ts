/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Agent control-plane contracts (HTTP slice). The Go agent marshals to identical
 * JSON. Connection-key secrets are NEVER part of any DTO.
 */
export const AGENT_STATUSES = ["pending", "approved", "revoked"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** "agent" = a host running the Go agent; "device" = an agentless SNMP/ping target. */
export type AgentKind = "agent" | "device";

export interface AgentDTO {
  id: string;
  name: string;
  /** Whether this is a real agent host or an agentless device (NAS/switch/UPS…). */
  kind: AgentKind;
  hostname: string | null;
  platform: string | null;
  /** Host IP/DNS the agent reported; the target for the server-side reachability ping. */
  address: string | null;
  status: AgentStatus;
  version: string | null;
  lastSeenAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  /** ISO build timestamp of the running agent binary (reported on register). */
  buildTime: string | null;
  /**
   * Live connectivity: true only while the agent's control socket is connected
   * AND its heartbeat is fresh. This is the lifecycle-independent "is it talking
   * to us right now" signal (an approved agent can be offline, and vice versa).
   */
  online: boolean;
  /**
   * Per-agent collect/push interval override in seconds. `null` = use the global
   * default (`agent.pushIntervalSec` setting). Applied to the running agent live
   * over the control channel — no restart needed.
   */
  pushIntervalSec: number | null;
  /** When true, the agent runs in verbose DEBUG logging mode (server-controlled). */
  debug: boolean;
}

/** Settings key + bounds for the global default agent collect/push interval. */
export const AGENT_PUSH_INTERVAL_KEY = "agent.pushIntervalSec";
export const AGENT_PUSH_INTERVAL_DEFAULT = 30;
export const AGENT_PUSH_INTERVAL_MIN = 5;
export const AGENT_PUSH_INTERVAL_MAX = 3600;
/** Preset cadences offered in the UI. */
export const AGENT_PUSH_INTERVALS = [
  { label: "5 seconds", sec: 5 },
  { label: "10 seconds", sec: 10 },
  { label: "15 seconds", sec: 15 },
  { label: "30 seconds", sec: 30 },
  { label: "1 minute", sec: 60 },
  { label: "2 minutes", sec: 120 },
  { label: "5 minutes", sec: 300 },
] as const;

/** Clamp an interval to the allowed bounds. */
export function clampPushInterval(sec: number): number {
  return Math.min(Math.max(Math.round(sec), AGENT_PUSH_INTERVAL_MIN), AGENT_PUSH_INTERVAL_MAX);
}

/**
 * Settings key for ADDITIONAL ingest hosts. The master backend controls each agent
 * (config + commands over its WSS channel); this list is delivered to agents in the
 * config response so they ALSO push their telemetry to these extra backends (e.g. a
 * development instance). Each entry is a base URL (https://host[:port]); the agent
 * uses its existing connection key for every target, so a target only accepts the
 * data if it knows that key (e.g. a dev DB cloned from production).
 */
export const AGENT_INGEST_HOSTS_KEY = "agent.ingestHosts";

/** A connection key as shown in the UI — never includes the secret value. */
export interface ConnectionKeyDTO {
  id: string;
  label: string;
  agentId: string | null;
  disabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface AgentRegisterRequest {
  name?: string;
  hostname?: string;
  platform?: string;
  version?: string;
  /** Primary host IP, used as the default server-side ping target. */
  address?: string;
  /** ISO build timestamp baked into the agent binary. */
  buildTime?: string;
}

export interface AgentRegisterResponse {
  agentId: string;
  status: AgentStatus;
}

// ── WSS control channel (server ⇄ agent) ───────────────────────────────────
export const AGENT_COMMAND_TYPES = ["restart", "update", "config", "rescan", "cancelScan"] as const;
export type AgentCommandType = (typeof AGENT_COMMAND_TYPES)[number];

export interface AgentCommandDTO {
  id: string;
  agentId: string;
  type: AgentCommandType;
  payload: Record<string, unknown> | null;
  status: "pending" | "sent" | "acked";
  createdAt: string;
}

/** Live folder-scan progress for a storage monitor (agent-collected). */
export interface ScanProgressMsg {
  t: "scan";
  monitorId: string;
  status: "running" | "done" | "cancelled" | "error";
  folders: number;
  files: number;
  bytes: number;
  current: string;
}

/** Messages the agent sends to the server over the control socket. */
export type AgentToServer =
  | { t: "register"; name?: string; hostname?: string; platform?: string; version?: string; address?: string; buildTime?: string }
  | { t: "heartbeat" }
  | { t: "ack"; commandId: string }
  | ScanProgressMsg;

/** Messages the server sends to the agent. */
export type ServerToAgent =
  | { t: "registered"; agentId: string; status: AgentStatus }
  | { t: "command"; command: AgentCommandDTO }
  | { t: "pong" };

/** One discoverable host item the operator can pick to monitor. */
export interface InventoryItem {
  name: string;
  /** Executable path (process) or display name (service). */
  detail?: string;
}

/** A host's discoverable services + processes, pushed by the agent. */
export interface AgentInventory {
  services: InventoryItem[];
  processes: InventoryItem[];
}

/** Stored inventory as served to operators, with the collection timestamp. */
export interface HostInventoryDTO extends AgentInventory {
  collectedAt: string | null;
}

/**
 * Rich per-unit detail for service/process monitors.
 * All optional — collected best-effort and absent for unit kinds that don't apply
 * (ping/host/storage). Carried through ingest → unit_states.sample → live.
 */
export type HostnameSource = "dns" | "netbios" | "dhcp" | "manual" | null;

/** One ESTABLISHED remote client connected to a monitored service's port. */
export interface ClientSample {
  ip: string;
  port: number; // remote port
  localPort?: number; // the service port it hit
  hostname?: string | null; // resolved name (reverse-DNS), cached, nullable
  hostnameSource?: HostnameSource;
  mac?: string | null; // from the ARP cache, when the client is on the LAN
}

/** Admin per-IP client annotation, applied when rendering connected clients. */
export interface ClientMetaDTO {
  ip: string;
  hostname: string | null; // custom name; overrides the agent-resolved hostname
  description: string | null;
  updatedAt: string;
}

export interface ClientMetaInput {
  hostname?: string | null;
  description?: string | null;
}

/** One wait type's accumulated wait, for the SQL Server top-waits list. */
export interface DbWait {
  type: string;
  waitMs: number;
}

/** One currently-running SQL Server request ("query client"); statement normalized. */
export interface DbSessionSample {
  sessionId: number;
  login?: string | null;
  host?: string | null;
  program?: string | null;
  status?: string | null;
  waitType?: string | null;
  blockedBy?: number | null;
  cpuMs?: number | null;
  elapsedMs?: number | null;
  statement?: string | null; // normalized (literals stripped)
}

/** Aggregate stats for one normalized query template (no literal values). */
export interface QueryStat {
  queryHash: string;
  normalizedText: string;
  execCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  logicalReads: number;
}

/** SQL Server health + performance sample (core subset). */
export interface DbSample {
  uptimeMin?: number | null;
  cpuPercent?: number | null;
  activeSessions?: number | null;
  connections?: number | null;
  blockedSessions?: number | null;
  deadlocks?: number | null;
  batchReqPerSec?: number | null;
  bufferCacheHitPct?: number | null;
  pleSeconds?: number | null;
  totalServerMemoryMB?: number | null;
  ioReadLatencyMs?: number | null;
  ioWriteLatencyMs?: number | null;
  topWaits?: DbWait[];
  sessions?: DbSessionSample[];
  queries?: QueryStat[]; // top queries when collectQueries is enabled
}

/** One persisted storage capacity datapoint (telemetry history). */
export interface StoragePoint {
  ts: string;
  usedPct: number | null;
  usedBytes: number | null;
  totalBytes: number | null;
}

/** Capacity-growth forecast derived from a storage history (days-to-full, etc.). */
export interface StorageForecast {
  /** Linear growth rate in bytes/day (negative when shrinking). */
  growthBytesPerDay: number;
  /** Days until the share is full at the current rate; null if not filling/unknown. */
  daysToFull: number | null;
  /** ISO date the share is projected to reach 100%; null if not filling/unknown. */
  projectedFullDate: string | null;
  /** Days the history spans, and how many samples informed the fit. */
  spanDays: number;
  samples: number;
}

/** One folder on a share with its recursive size + file/subfolder counts. */
export interface FolderNode {
  name: string;
  sizeBytes: number;
  fileCount: number;
  /** Number of subfolders beneath it (within the scanned depth). */
  folderCount?: number;
}

/** NAS/SMB share capacity sample (core subset). */
export interface StorageSample {
  reachable: boolean;
  totalBytes?: number | null;
  freeBytes?: number | null;
  usedBytes?: number | null;
  usedPct?: number | null;
  /** Top-level / watched folder sizes (when folder collection is enabled). */
  folders?: FolderNode[];
  /** Probe error (server-side SMB), when unreachable. */
  error?: string | null;
}

/** SNMP device categories a profile can target. */
export const SNMP_DEVICE_TYPES = ["nas", "switch", "ups", "server", "generic"] as const;
export type SnmpDeviceType = (typeof SNMP_DEVICE_TYPES)[number];

/** One custom OID in a profile (a scalar reading with display metadata). */
export interface SnmpProfileOid {
  label: string;
  oid: string;
  unit?: string;
  group?: string;
}

/** A SNMP table to walk: an entry base OID + a column map (label → column number). */
export interface SnmpProfileTableCol {
  label: string;
  col: number;
  unit?: string;
  /** Map raw value → label for enum columns (e.g. {"0":"ready","-1":"warning"}). */
  enum?: Record<string, string>;
}
export interface SnmpProfileTable {
  name: string;
  oid: string; // table entry base, e.g. 1.3.6.1.4.1.55062.2.10.1.1
  columns: SnmpProfileTableCol[];
}

/** A collected table (per-row), rendered as a grid in the SNMP panel. */
export interface SnmpTable {
  name: string;
  headers: string[];
  rows: string[][];
}

/** A reusable SNMP "MIB profile" (master), keyed by vendor / device type / model. */
export interface SnmpProfileDTO {
  id: string;
  name: string;
  vendor: string;
  deviceType: string;
  model: string;
  /** Enables HOST-RESOURCES + IF-MIB collection (uptime/CPU/RAM/volumes/NICs). */
  standard: boolean;
  oids: SnmpProfileOid[];
  tables: SnmpProfileTable[];
  /** Seeded built-in profile — protected from edit/delete. */
  isSystem: boolean;
}

export interface SnmpProfileInput {
  name: string;
  vendor?: string;
  deviceType?: string;
  model?: string;
  standard?: boolean;
  oids?: SnmpProfileOid[];
  tables?: SnmpProfileTable[];
}

/** One polled SNMP value (a configured/custom OID and its current reading). */
export interface SnmpItem {
  label: string;
  oid: string;
  value: string;
  unit?: string;
  group?: string;
}

/** One storage volume read from HOST-RESOURCES (hrStorage). */
export interface SnmpVolume {
  name: string;
  usedPct: number;
}

/** One physical disk (vendor MIB, e.g. QNAP HdTable) with SMART-ish health. */
export interface SnmpDisk {
  name: string;
  status?: string | null;
  tempC?: number | null;
  model?: string | null;
  smart?: string | null;
}

/** One network interface (IF-MIB) with identity + throughput (counter deltas). */
export interface SnmpNic {
  name: string;
  mac?: string | null;
  ips?: string[];
  rxBps?: number | null;
  txBps?: number | null;
}

/**
 * Rich SNMP poll result: standard HOST-RESOURCES/IF-MIB health
 * (uptime/CPU/RAM/volumes/NICs) plus any profile-specific custom OID readings.
 */
export interface SnmpSample {
  reachable: boolean;
  error?: string | null;
  uptimeMin?: number | null;
  cpuPercent?: number | null;
  memUsedPct?: number | null;
  volumes?: SnmpVolume[];
  nics?: SnmpNic[];
  disks?: SnmpDisk[];
  items?: SnmpItem[];
  tables?: SnmpTable[];
}

export interface UnitMeta {
  user?: string | null; // process owner account
  exePath?: string | null; // running executable path
  cpuPercent?: number | null;
  memMB?: number | null;
  uptimeSec?: number | null; // derived from process start time
  threads?: number | null;
  listenPorts?: number[]; // ports the process is LISTENing on
  clientCount?: number | null; // current ESTABLISHED connections to those ports
  clients?: ClientSample[]; // the connected clients (capped)
  db?: DbSample; // SQL Server health detail (for database monitors)
  storage?: StorageSample; // NAS/SMB capacity (for storage monitors)
  snmp?: SnmpSample; // SNMP OID readings (for snmp monitors)
}

/** One monitored unit's current health, as reported by the agent. */
export interface UnitSample {
  entity: string;
  status: "UP" | "DEGRADED" | "HANG" | "DOWN" | "UNKNOWN";
  pid?: number | null;
  critical?: boolean;
  meta?: UnitMeta;
}

/** One monitor's config as delivered to the agent so it can collect for it. */
export interface AgentMonitorConfig {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
}

/** Settings key for the timezone the agent stamps its logs in (IANA name). */
export const AGENT_TIMEZONE_KEY = "agent.timezone";

/** Reply to GET /api/agent/config — the agent's enabled monitor list. */
export interface AgentConfigResponse {
  monitors: AgentMonitorConfig[];
  /** Effective collect/push cadence (seconds) the agent should run at. */
  pushIntervalSec: number;
  /** Server timezone (IANA) for the agent's log timestamps; agent may override locally. */
  timezone: string;
}

export interface AgentIngestRequest {
  metrics?: { cpuPct?: number; memPct?: number; memUsedMb?: number; extra?: Record<string, unknown> };
  /** Per-monitor health; the server diffs these against last-known state. */
  units?: UnitSample[];
  events?: Array<{ entity: string; type: string; oldStatus?: string; newStatus?: string; detail?: Record<string, unknown> }>;
  logs?: Array<{ category: string; level: string; message: string; context?: Record<string, unknown> }>;
}
