/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Agent lifecycle: self-registration (via a connection key), approval/revocation,
 * and lightweight liveness. Agents start "pending" and gain ingest rights only
 * once a superadmin approves them.
 */
import { eq } from "drizzle-orm";
import { agentKeys, agents, type MasterDb } from "@argus/db";
import type { AgentDTO, AgentRegisterRequest, AgentRegisterResponse } from "@argus/shared";
import { AGENT_INGEST_HOSTS_KEY, AGENT_PUSH_INTERVAL_DEFAULT, AGENT_PUSH_INTERVAL_KEY, AGENT_TIMEZONE_KEY, clampPushInterval } from "@argus/shared";
import type { AgentKeyRow } from "@/services/agent-keys.js";
import { ensureDefaultPingMonitor } from "@/services/monitors.js";
import { getSetting } from "@/services/settings.js";

type AgentRow = typeof agents.$inferSelect;

/**
 * An agent is "online" only while its control socket is connected AND its last
 * heartbeat is fresh. The window is 3× the agent's 20s heartbeat so a single
 * missed beat doesn't flap the indicator, but a dead (half-open) socket still
 * reads offline within a minute. Without this, a killed agent could linger as
 * "online" until the TCP close finally propagates.
 */
export const ONLINE_STALENESS_MS = 60_000;

/** Predicate the route/live layers pass so this DB-agnostic module stays pure. */
export type IsConnected = (agentId: string) => boolean;

export function isAgentOnline(connected: boolean, lastSeenAt: string | null): boolean {
  if (!connected || !lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_STALENESS_MS;
}

const toDTO = (a: AgentRow, online: boolean): AgentDTO => ({
  id: a.id,
  name: a.name,
  kind: a.kind === "device" ? "device" : "agent",
  hostname: a.hostname,
  platform: a.platform,
  address: a.address,
  status: a.status as AgentDTO["status"],
  version: a.version,
  lastSeenAt: a.lastSeenAt,
  approvedAt: a.approvedAt,
  createdAt: a.createdAt,
  buildTime: (a.metadata as { buildTime?: string } | null)?.buildTime ?? null,
  online,
  pushIntervalSec: a.pushIntervalSec ?? null,
  debug: (a.metadata as { debug?: boolean } | null)?.debug === true,
});

function onlineFor(isConnected: IsConnected | undefined, a: AgentRow): boolean {
  return isConnected ? isAgentOnline(isConnected(a.id), a.lastSeenAt) : false;
}

export async function listAgents(db: MasterDb, isConnected?: IsConnected): Promise<AgentDTO[]> {
  return (await db.select().from(agents)).map((a) => toDTO(a, onlineFor(isConnected, a)));
}

export async function getAgent(db: MasterDb, id: string, isConnected?: IsConnected): Promise<AgentDTO | undefined> {
  const [row] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  return row ? toDTO(row, onlineFor(isConnected, row)) : undefined;
}

/**
 * Create an agentless device (NAS/switch/UPS…) — an approved agent row with
 * kind="device" and no connection key. Its monitors (snmp/ping) are probed
 * server-side, so it appears as its own card without anything to install.
 */
export async function createDevice(db: MasterDb, input: { name: string; address?: string | null }): Promise<AgentDTO> {
  const now = new Date().toISOString();
  const [row] = await db
    .insert(agents)
    .values({ name: input.name, kind: "device", status: "approved", approvedAt: now, address: input.address ?? null })
    .returning();
  if (!row) throw new Error("failed to create device");
  // Every device gets the must-have server-side reachability ping automatically.
  if (input.address) await ensureDefaultPingMonitor(db, row.id, input.address);
  return toDTO(row, false);
}

/** Register (or re-attach) an agent for a connection key. Idempotent per key. */
export async function registerAgent(
  db: MasterDb,
  keyRow: AgentKeyRow,
  req: AgentRegisterRequest,
): Promise<AgentRegisterResponse> {
  const now = new Date().toISOString();
  const fields: Partial<typeof agents.$inferInsert> = {
    hostname: req.hostname ?? null,
    platform: req.platform ?? null,
    version: req.version ?? null,
    address: req.address ?? null,
    lastSeenAt: now,
  };
  // Build time rides in metadata (no schema column needed); only set when reported.
  if (req.buildTime) fields.metadata = { buildTime: req.buildTime };

  if (keyRow.agentId) {
    const [updated] = await db.update(agents).set(fields).where(eq(agents.id, keyRow.agentId)).returning();
    if (updated) return { agentId: updated.id, status: updated.status as AgentDTO["status"] };
  }

  const [created] = await db
    .insert(agents)
    .values({ name: req.name ?? req.hostname ?? "agent", status: "pending", ...fields })
    .returning();
  if (!created) throw new Error("failed to register agent");
  await db.update(agentKeys).set({ agentId: created.id }).where(eq(agentKeys.id, keyRow.id));
  return { agentId: created.id, status: created.status as AgentDTO["status"] };
}

export async function approveAgent(db: MasterDb, id: string, isConnected?: IsConnected): Promise<AgentDTO | undefined> {
  const [row] = await db
    .update(agents)
    .set({ status: "approved", approvedAt: new Date().toISOString() })
    .where(eq(agents.id, id))
    .returning();
  return row ? toDTO(row, onlineFor(isConnected, row)) : undefined;
}

export async function revokeAgent(db: MasterDb, id: string, isConnected?: IsConnected): Promise<AgentDTO | undefined> {
  const [row] = await db.update(agents).set({ status: "revoked" }).where(eq(agents.id, id)).returning();
  return row ? toDTO(row, onlineFor(isConnected, row)) : undefined;
}

export async function updateAgent(db: MasterDb, id: string, patch: { name?: string; pushIntervalSec?: number | null; debug?: boolean }, isConnected?: IsConnected): Promise<AgentDTO | undefined> {
  const set: Partial<typeof agents.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.pushIntervalSec !== undefined) {
    set.pushIntervalSec = patch.pushIntervalSec === null ? null : clampPushInterval(patch.pushIntervalSec);
  }
  if (patch.debug !== undefined) {
    // Stored in the metadata jsonb (no dedicated column needed).
    const [cur] = await db.select({ metadata: agents.metadata }).from(agents).where(eq(agents.id, id)).limit(1);
    set.metadata = { ...(cur?.metadata ?? {}), debug: patch.debug };
  }
  const [row] = await db.update(agents).set(set).where(eq(agents.id, id)).returning();
  return row ? toDTO(row, onlineFor(isConnected, row)) : undefined;
}

/** Whether an agent is in debug mode (verbose logging). Read from metadata.debug. */
export async function agentDebugEnabled(db: MasterDb, agentId: string): Promise<boolean> {
  const [row] = await db.select({ metadata: agents.metadata }).from(agents).where(eq(agents.id, agentId)).limit(1);
  return (row?.metadata as { debug?: boolean } | null)?.debug === true;
}

/**
 * The effective collect/push interval (seconds) for an agent: its own override,
 * else the global default setting, else the built-in default. Always clamped.
 */
export async function effectivePushInterval(db: MasterDb, agentId: string): Promise<number> {
  const [row] = await db.select({ override: agents.pushIntervalSec }).from(agents).where(eq(agents.id, agentId)).limit(1);
  if (row?.override != null) return clampPushInterval(row.override);
  const raw = await getSetting(db, AGENT_PUSH_INTERVAL_KEY);
  return clampPushInterval(typeof raw === "number" ? raw : AGENT_PUSH_INTERVAL_DEFAULT);
}

/**
 * The timezone agents stamp their logs in: the `agent.timezone` setting, else the
 * server's own TZ env, else UTC. Operators can override per host in the agent config.
 */
export async function effectiveTimezone(db: MasterDb): Promise<string> {
  const raw = await getSetting(db, AGENT_TIMEZONE_KEY);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return process.env.TZ?.trim() || "UTC";
}

/**
 * Additional ingest hosts (base URLs) the agent should ALSO push telemetry to,
 * beyond this master. Managed in the UI and delivered in the agent config so the
 * master stays in control. Returns a de-duplicated, trimmed list of valid URLs.
 */
export async function effectiveIngestHosts(db: MasterDb): Promise<string[]> {
  const raw = await getSetting(db, AGENT_INGEST_HOSTS_KEY);
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const url = v.trim().replace(/\/+$/, "");
    if (/^https?:\/\/.+/i.test(url)) out.add(url);
  }
  return [...out];
}

export async function deleteAgent(db: MasterDb, id: string): Promise<boolean> {
  const [row] = await db.delete(agents).where(eq(agents.id, id)).returning();
  return Boolean(row);
}

export async function touchAgent(db: MasterDb, id: string): Promise<void> {
  await db.update(agents).set({ lastSeenAt: new Date().toISOString() }).where(eq(agents.id, id));
}

/** Whether an agent id is currently approved (gate for ingest). */
export async function isApproved(db: MasterDb, id: string): Promise<boolean> {
  const [row] = await db.select({ status: agents.status }).from(agents).where(eq(agents.id, id)).limit(1);
  return row?.status === "approved";
}
