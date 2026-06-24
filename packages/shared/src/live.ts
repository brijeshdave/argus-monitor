/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Operator LIVE-state contracts. Operators (and wallboards) connect to `WS /ws`
 * and receive a `snapshot` of current agent + unit health, then incremental
 * `patch` messages as the backend ingests new telemetry. The Go agent never
 * speaks this protocol — these are server → operator only.
 */

/** Coarse health of a single monitored unit. */
export type LiveStatus = "UP" | "DEGRADED" | "HANG" | "DOWN" | "UNKNOWN";

/** One monitored unit's current health, as broadcast to operators. */
export interface LiveUnit {
  sourceId: string;
  entity: string;
  status: LiveStatus;
  pid: number | null;
  /** Server-side ping latency (ms) for ping units; absent for other unit kinds. */
  latencyMs?: number | null;
  /** ISO time the unit entered its current status — drives "DOWN for 4m" on tiles. */
  since?: string | null;
  /** Rich service/process detail (pid context, cpu/mem, ports, clients) when reported. */
  meta?: import("./agent.js").UnitMeta | null;
}

/** One agent's live connectivity, as broadcast to operators. */
export interface LiveAgent {
  id: string;
  name: string;
  status: string;
  online: boolean;
  lastSeenAt: string | null;
  /** Latest host CPU / memory percent for the card gauges (null until reported). */
  cpuPct?: number | null;
  memPct?: number | null;
}

/** Full live-state baseline, sent immediately on connect. */
export interface LiveSnapshot {
  t: "snapshot";
  agents: LiveAgent[];
  units: LiveUnit[];
  ts: string;
}

/**
 * Incremental agent change (connectivity flip and/or fresh host metrics). Items are
 * partial — only the provided fields are merged over the existing agent — so a
 * metrics-only patch never clobbers name/online and vice versa. `id` is required.
 */
export interface LiveAgentPatch {
  t: "agent";
  agents: Array<Partial<LiveAgent> & { id: string }>;
  ts: string;
}

/** Incremental update for a single agent's units after an ingest. */
export interface LivePatch {
  t: "patch";
  agentId: string;
  units: LiveUnit[];
  ts: string;
}

/** One live log line, as streamed to operators tailing an agent's logs. */
export interface LiveLogLine {
  level: string;
  message: string;
  category: string;
  ts: string;
}

/** A batch of fresh log lines from one agent, broadcast on ingest. */
export interface LiveLog {
  t: "log";
  agentId: string;
  lines: LiveLogLine[];
  ts: string;
}

export type LiveMessage = LiveSnapshot | LivePatch | LiveAgentPatch | LiveLog;
