/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Monitor domain service. Provides CRUD over the monitors table scoped to an
 * agent. Rows are mapped to MonitorDTO before leaving this module — the rest of
 * the stack never sees raw DB rows.
 */
import { and, eq, inArray } from "drizzle-orm";
import { monitors, type MasterDb } from "@argus/db";
import type { AgentMonitorConfig, MonitorDTO, MonitorType } from "@argus/shared";

type MonitorRow = typeof monitors.$inferSelect;

const toDTO = (r: MonitorRow): MonitorDTO => ({
  id: r.id,
  agentId: r.agentId,
  type: r.type as MonitorType,
  name: r.name,
  enabled: r.enabled,
  config: (r.config ?? {}) as Record<string, unknown>,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export interface CreateMonitorInput {
  agentId: string;
  type: MonitorType;
  name: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface UpdateMonitorInput {
  name?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  agentId?: string; // move to another agent/device
}

/** List all monitors, optionally filtered to a single agent. */
export async function listMonitors(db: MasterDb, agentId?: string): Promise<MonitorDTO[]> {
  const rows = agentId
    ? await db.select().from(monitors).where(eq(monitors.agentId, agentId))
    : await db.select().from(monitors);
  return rows.map(toDTO);
}

/**
 * The enabled monitors an agent should collect for, trimmed to the wire shape the
 * agent needs (no DB timestamps, no enabled flag — disabled rows are filtered out).
 */
export async function listAgentMonitorConfig(db: MasterDb, agentId: string): Promise<AgentMonitorConfig[]> {
  const rows = await db
    .select()
    .from(monitors)
    .where(and(eq(monitors.agentId, agentId), eq(monitors.enabled, true)));
  return rows
    // Server-side monitors are executed by the backend, never delivered to the agent:
    // SNMP always, and ping/storage when explicitly marked server-side.
    .filter((r) => r.type !== "snmp")
    .filter((r) => !((r.type === "ping" || r.type === "storage") && (r.config as { server?: unknown })?.server === true))
    .map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      config: (r.config ?? {}) as Record<string, unknown>,
    }));
}

/** All enabled ping monitors (any agent) — the backend ping scheduler's worklist. */
export async function listEnabledPingMonitors(db: MasterDb): Promise<MonitorDTO[]> {
  const rows = await db
    .select()
    .from(monitors)
    .where(and(eq(monitors.type, "ping"), eq(monitors.enabled, true)));
  return rows.map(toDTO);
}

/** All enabled SNMP monitors (any agent) — the backend SNMP scheduler's worklist. */
export async function listEnabledSnmpMonitors(db: MasterDb): Promise<MonitorDTO[]> {
  const rows = await db
    .select()
    .from(monitors)
    .where(and(eq(monitors.type, "snmp"), eq(monitors.enabled, true)));
  return rows.map(toDTO);
}

/** All enabled synthetic checks (http/tcp/dns) — the central checks scheduler's worklist. */
export async function listEnabledChecks(db: MasterDb): Promise<MonitorDTO[]> {
  const rows = await db
    .select()
    .from(monitors)
    .where(and(inArray(monitors.type, ["http", "tcp", "dns"]), eq(monitors.enabled, true)));
  return rows.map(toDTO);
}

/** Enabled server-side storage monitors (config.server === true) — probed by the host. */
export async function listEnabledServerStorageMonitors(db: MasterDb): Promise<MonitorDTO[]> {
  const rows = await db
    .select()
    .from(monitors)
    .where(and(eq(monitors.type, "storage"), eq(monitors.enabled, true)));
  return rows.map(toDTO).filter((m) => (m.config as { server?: unknown })?.server === true);
}

/**
 * Ensure an agent has its default server-side reachability ping. Idempotent: keyed
 * on config.default === true, so re-approving an agent never duplicates it. Skips
 * silently when the agent reported no address (nothing to ping).
 */
export async function ensureDefaultPingMonitor(db: MasterDb, agentId: string, address: string | null): Promise<void> {
  if (!address) return;
  const existing = await db.select().from(monitors).where(eq(monitors.agentId, agentId));
  if (existing.some((m) => m.type === "ping" && (m.config as { default?: unknown })?.default === true)) return;
  await createMonitor(db, {
    agentId,
    type: "ping",
    name: "Host reachability",
    enabled: true,
    config: { host: address, server: true, default: true },
  });
}

/** Extract the host from a UNC path (\\host\share → host). "" if not a UNC path. */
function uncHost(path: string): string {
  const m = /^\\\\+([^\\/]+)/.exec(path);
  return m?.[1] ?? "";
}

/**
 * Ensure a storage monitor has a companion server-side reachability ping to the NAS
 * host, so you can tell "network down" from "SMB auth failed". Idempotent (keyed on
 * the derived name); skips when the path isn't a UNC path.
 */
export async function ensureStoragePing(db: MasterDb, agentId: string, storageName: string, path: string): Promise<void> {
  const host = uncHost(path);
  if (!host) return;
  const name = `${storageName} · reachability`;
  const existing = await db.select().from(monitors).where(eq(monitors.agentId, agentId));
  if (existing.some((m) => m.name === name)) return;
  await createMonitor(db, { agentId, type: "ping", name, config: { host, server: true } });
}

/** Fetch a single monitor by id, or undefined if not found. */
export async function getMonitor(db: MasterDb, id: string): Promise<MonitorDTO | undefined> {
  const [row] = await db.select().from(monitors).where(eq(monitors.id, id)).limit(1);
  return row ? toDTO(row) : undefined;
}

/** Create a new monitor bound to an agent. */
export async function createMonitor(db: MasterDb, input: CreateMonitorInput): Promise<MonitorDTO> {
  const [created] = await db
    .insert(monitors)
    .values({
      agentId: input.agentId,
      type: input.type,
      name: input.name,
      enabled: input.enabled ?? true,
      config: input.config ?? {},
    })
    .returning();
  if (!created) throw new Error("failed to create monitor");
  return toDTO(created);
}

/** Patch mutable fields of an existing monitor. Returns undefined when not found. */
export async function updateMonitor(
  db: MasterDb,
  id: string,
  patch: UpdateMonitorInput,
): Promise<MonitorDTO | undefined> {
  const set: Partial<typeof monitors.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.config !== undefined) set.config = patch.config;
  if (patch.agentId !== undefined) set.agentId = patch.agentId;

  const [row] = await db.update(monitors).set(set).where(eq(monitors.id, id)).returning();
  return row ? toDTO(row) : undefined;
}

/** Delete a monitor by id. Returns true when deleted, false when not found. */
export async function deleteMonitor(db: MasterDb, id: string): Promise<boolean> {
  const [row] = await db.delete(monitors).where(eq(monitors.id, id)).returning();
  return Boolean(row);
}
