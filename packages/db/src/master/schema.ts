/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * MASTER database schema (Drizzle / pg-core) — the system of record for identity,
 * RBAC/ABAC, agents, monitors, encrypted secrets and settings.
 */
import {
  pgTable,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
// NOTE: relative (not "@/") import — drizzle-kit loads this file outside the TS
// path resolver, so it must not depend on the "@/*" alias.
import { pk, fk, timestamps } from "../helpers.js";

// ---------------------------------------------------------------------------
// Identity — users
// ---------------------------------------------------------------------------

/** Core identity record. Passwords are null for OIDC-federated users. */
export const users = pgTable("users", {
  id: pk(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull().default(""),
  email: text("email"),
  passwordHash: text("password_hash"),
  authProvider: text("auth_provider").notNull().default("local"), // "local" | "oidc"
  disabled: boolean("disabled").notNull().default(false),
  isOwner: boolean("is_owner").notNull().default(false),
  isSystem: boolean("is_system").notNull().default(false),
  // Two-factor (TOTP, RFC 6238). The secret is an AES-256-GCM envelope (never
  // plaintext); recovery codes are stored only as SHA-256 hex hashes.
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  totpSecret: text("totp_secret"), // AES-GCM envelope, nullable until enrolled
  totpRecovery: jsonb("totp_recovery").$type<string[]>(), // sha256-hex of unused recovery codes
  // Monotonic token version. Bumped on global-revoke actions (password change,
  // 2FA reset, terminate-all) so every already-issued access token whose `tv`
  // claim no longer matches is rejected on its next request — instant kill.
  tokenVersion: integer("token_version").notNull().default(0),
  // Per-account login lockout: consecutive failed local logins are counted; once
  // the count reaches the configured threshold the account is locked until the
  // `lockedUntil` instant. Reset on a successful login or any admin/security clear.
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "string" }),
  lastLoginAt: timestamp("last_login_at", {
    withTimezone: true,
    mode: "string",
  }),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// RBAC — groups, roles, permissions, and their join tables
// ---------------------------------------------------------------------------

/** Logical collection of users. Access flows: user → group → role → permission. */
export const groups = pgTable("groups", {
  id: pk(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  isSystem: boolean("is_system").notNull().default(false),
  ...timestamps(),
});

/** Named set of permissions. System roles are seeded on boot and cannot be deleted. */
export const roles = pgTable("roles", {
  id: pk(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  isSystem: boolean("is_system").notNull().default(false),
  ...timestamps(),
});

/** Atomic capability key of the form "resource:action" (e.g. "agents:approve"). */
export const permissions = pgTable("permissions", {
  id: pk(),
  key: text("key").notNull().unique(), // "resource:action"
  description: text("description").notNull().default(""),
  ...timestamps(),
});

/** Maps which permissions a role grants. Cascade-delete keeps things tidy. */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: fk("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: fk("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permissionId] }),
  }),
);

/** Assigns roles to groups. A group can hold many roles. */
export const groupRoles = pgTable(
  "group_roles",
  {
    groupId: fk("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    roleId: fk("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.groupId, t.roleId] }),
  }),
);

/** Places users into groups — the ONLY path through which users gain permissions. */
export const userGroups = pgTable(
  "user_groups",
  {
    userId: fk("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: fk("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.groupId] }),
  }),
);

// ---------------------------------------------------------------------------
// ABAC — subject attributes attached to users
// ---------------------------------------------------------------------------

/** Arbitrary key/value attributes on a user for attribute-based access evaluation. */
export const userAttributes = pgTable("user_attributes", {
  id: pk(),
  userId: fk("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: text("value").notNull(),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// Agents — monitored hosts that push snapshots to the backend
// ---------------------------------------------------------------------------

/** One row per registered monitoring agent (Windows/Linux host running the Go agent). */
export const agents = pgTable("agents", {
  id: pk(),
  name: text("name").notNull(),
  // "agent" = a host running the Go agent; "device" = an agentless target (NAS,
  // switch, UPS…) probed server-side via SNMP/ping. Devices have no connection key.
  kind: text("kind").notNull().default("agent"),
  hostname: text("hostname"),
  platform: text("platform"),
  address: text("address"), // host IP/DNS the agent reports — target for server-side ping
  status: text("status").notNull().default("pending"), // "pending"|"approved"|"revoked"
  version: text("version"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
  // Per-agent collect/push interval override (seconds). NULL = use global default.
  pushIntervalSec: integer("push_interval_sec"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  ...timestamps(),
});

/** Hashed bearer keys used by agents to authenticate against the ingest endpoint. */
export const agentKeys = pgTable("agent_keys", {
  id: pk(),
  agentId: fk("agent_id").references(() => agents.id, { onDelete: "cascade" }), // nullable: key may be minted before binding
  label: text("label").notNull().default(""),
  keyHash: text("key_hash").notNull(), // hashed connection key
  secretRef: text("secret_ref"), // logical reference into the secrets table
  disabled: boolean("disabled").notNull().default(false),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// Secrets — AES-256-GCM envelopes for sensitive material
// ---------------------------------------------------------------------------

/** Encrypted secret envelopes stored by logical name; never exposes plaintext. */
export const secrets = pgTable("secrets", {
  id: pk(),
  ref: text("ref").notNull().unique(), // logical name e.g. "agentkey:<id>"
  ciphertext: text("ciphertext").notNull(), // AES-256-GCM envelope (base64)
  keyVersion: integer("key_version").notNull().default(1),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// Settings — arbitrary runtime key/value configuration
// ---------------------------------------------------------------------------

/** Global platform settings stored as JSON values keyed by a string. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// OIDC providers — external identity federation
// ---------------------------------------------------------------------------

/** Configuration for each external OpenID Connect identity provider. */
export const oidcProviders = pgTable("oidc_providers", {
  id: pk(),
  name: text("name").notNull(),
  issuer: text("issuer").notNull(),
  clientId: text("client_id").notNull(),
  clientSecretRef: text("client_secret_ref"), // reference into secrets table
  enabled: boolean("enabled").notNull().default(false),
  brand: text("brand").notNull().default("generic"), // login-button brand (icon/label)
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// Monitors — per-agent monitoring targets
// ---------------------------------------------------------------------------

/** Defines a single monitoring target (service, process, host, DB, storage, ping) bound to an agent. */
export const monitors = pgTable("monitors", {
  id: pk(),
  agentId: fk("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "service"|"process"|"host"|"database"|"storage"|"ping"
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// SNMP profiles — reusable device "MIB profiles" (master), keyed by vendor /
// device type / model. `standard` enables the built-in HOST-RESOURCES + IF-MIB
// collection (uptime/CPU/RAM/volumes/NICs); `oids` adds custom scalar readings.
// System profiles (isSystem) are seeded built-ins and cannot be edited/deleted.
// ---------------------------------------------------------------------------

export const snmpProfiles = pgTable("snmp_profiles", {
  id: pk(),
  name: text("name").notNull(),
  vendor: text("vendor").notNull().default(""),
  deviceType: text("device_type").notNull().default("generic"), // nas|switch|ups|server|generic
  model: text("model").notNull().default(""),
  standard: boolean("standard").notNull().default(true),
  oids: jsonb("oids").$type<Array<{ label: string; oid: string; unit?: string; group?: string }>>().notNull().default([]),
  // SNMP tables to walk (e.g. QNAP diskTable) → per-row rendering. Each: an entry base
  // OID + column map (label → column number).
  tables: jsonb("tables").$type<Array<{ name: string; oid: string; columns: Array<{ label: string; col: number; unit?: string; enum?: Record<string, string> }> }>>().notNull().default([]),
  isSystem: boolean("is_system").notNull().default(false),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// MIB objects — OID→name map parsed from uploaded SNMP MIB files, used to resolve
// numeric OIDs to friendly names (+ units) in the browse tool and panels.
// ---------------------------------------------------------------------------
export const mibObjects = pgTable("mib_objects", {
  oid: text("oid").primaryKey(),
  name: text("name").notNull(),
  unit: text("unit"),
  description: text("description"),
  mib: text("mib").notNull().default(""), // source module name (for list/delete)
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// Retention — per-data-type event/metric pruning policy
// ---------------------------------------------------------------------------

/** Controls how long each category of time-series or event data is retained. */
export const retentionConfig = pgTable("retention_config", {
  dataType: text("data_type").primaryKey(), // e.g. "status_events","host_metrics","audit_log","logs","notifications"
  days: integer("days"), // null = unlimited
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// Refresh tokens — rotating session credentials (hashed at rest)
// ---------------------------------------------------------------------------

/** One row per issued refresh token (stored as a SHA-256 hash; rotated on use). */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: pk(),
    userId: fk("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(), // sha256 hex of the opaque refresh token
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }), // set on rotation/logout
    userAgent: text("user_agent"), // captured at issuance — for the session list UI
    ip: text("ip"), // client IP captured at issuance
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }), // set on issue + rotation
    ...timestamps(),
  },
  (t) => ({
    byUser: index("refresh_tokens_user_idx").on(t.userId),
    byHash: index("refresh_tokens_hash_idx").on(t.tokenHash),
  }),
);

// ---------------------------------------------------------------------------
// Agent commands — server→agent command queue (restart / update / config)
// ---------------------------------------------------------------------------

/** Durable queue of commands pushed to an agent over the WSS control channel. */
export const agentCommands = pgTable(
  "agent_commands",
  {
    id: pk(),
    agentId: fk("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "restart" | "update" | "config"
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("pending"), // "pending"|"sent"|"acked"
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
    ackedAt: timestamp("acked_at", { withTimezone: true, mode: "string" }),
    ...timestamps(),
  },
  (t) => ({ byAgent: index("agent_commands_agent_idx").on(t.agentId, t.status) }),
);

// ---------------------------------------------------------------------------
// Wallboards — saved dashboard layouts rendered on big-screen displays
// ---------------------------------------------------------------------------

/** A named, reusable wallboard layout. System/default layouts are protected. */
export const wallLayouts = pgTable("wall_layouts", {
  id: pk(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isDefault: boolean("is_default").notNull().default(false),
  isSystem: boolean("is_system").notNull().default(false),
  layout: jsonb("layout").$type<Record<string, unknown>>().notNull().default({}),
  rotateSec: integer("rotate_sec").notNull().default(10), // wallboard view auto-rotation (0 = paused)
  template: text("template").notNull().default("flex"), // rich-wall layout: flex|cols2|cols3|rows2|single
  // Rich-wall scoping: { mode?: "panels"|"tiles"; hosts?: string[]|null; metrics?: Record<agentId,string[]> }
  panelConfig: jsonb("panel_config").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps(),
});

/** A group of display devices that share an assigned wallboard (e.g. "NOC", "Floor"). */
export const wallDeviceGroups = pgTable("wall_device_groups", {
  id: pk(),
  name: text("name").notNull(),
  layoutId: fk("layout_id").references(() => wallLayouts.id), // board shown on this group's screens
  ...timestamps(),
});

/** A registered display device that renders a wallboard; pairs via a one-time code. */
export const wallDevices = pgTable("wall_devices", {
  id: pk(),
  name: text("name").notNull(),
  status: text("status").notNull().default("pending"), // "pending"|"approved"|"revoked"
  pairingCode: text("pairing_code").notNull().unique(),
  tokenHash: text("token_hash"), // sha256 of the device token (set on approval)
  fingerprint: text("fingerprint"), // stable client id → recognise the same screen across re-pairs
  layoutId: fk("layout_id").references(() => wallLayouts.id), // per-device override of the group board
  groupId: fk("group_id").references(() => wallDeviceGroups.id),
  ipBound: text("ip_bound"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// Ticker — scrolling status messages shown across dashboards/wallboards
// ---------------------------------------------------------------------------

/** A single scrolling ticker message, optionally windowed and/or recurring. */
export const tickerMessages = pgTable("ticker_messages", {
  id: pk(),
  text: text("text").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  severity: text("severity").notNull().default("info"), // "info"|"warning"|"critical"
  priority: integer("priority").notNull().default(0),
  startsAt: timestamp("starts_at", { withTimezone: true, mode: "string" }),
  endsAt: timestamp("ends_at", { withTimezone: true, mode: "string" }),
  recurrence: jsonb("recurrence").$type<Record<string, unknown>>(),
  // Targeting: which wall device-groups show this on screens, and which user-groups
  // see it in the operator UI. NULL/empty = everyone (all walls / all users).
  deviceGroupIds: jsonb("device_group_ids").$type<string[]>(),
  userGroupIds: jsonb("user_group_ids").$type<string[]>(),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// Public status page — singleton config for the unauthenticated status page
// ---------------------------------------------------------------------------

/**
 * Singleton (id="default") configuration for the public, unauthenticated status
 * page. `items` reference agents/monitors by id, but only their coarse status +
 * a human label are ever exposed — never the ids/hostnames themselves.
 */
export const publicConfig = pgTable("public_config", {
  id: text("id").primaryKey(), // always "default" — the service upserts this single row
  enabled: boolean("enabled").notNull().default(false),
  title: text("title").notNull().default("System Status"),
  description: text("description"), // optional subtitle/blurb under the title
  showUptime: boolean("show_uptime").notNull().default(true),
  showHistory: boolean("show_history").notNull().default(true), // per-item daily uptime sparkline
  historyDays: integer("history_days").notNull().default(90), // sparkline window
  noticeLevel: text("notice_level"), // "info" | "maintenance" | "incident"
  noticeMessage: text("notice_message"), // operator banner; null/blank = none
  items: jsonb("items")
    .$type<Array<{ kind: "agent" | "monitor"; refId: string; label: string; group?: string }>>()
    .notNull()
    .default([]),
  ...timestamps(),
});

/**
 * Admin per-IP client annotation: a custom name (overrides the agent-resolved
 * hostname) and a free-text description, applied when rendering connected clients.
 */
export const clientMeta = pgTable("client_meta", {
  ip: text("ip").primaryKey(),
  hostname: text("hostname"), // manual override; null = use agent-resolved name
  description: text("description"),
  updatedBy: text("updated_by"),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// Aggregate export — pass to the Drizzle client constructor
// ---------------------------------------------------------------------------

export const masterSchema = {
  users,
  clientMeta,
  groups,
  roles,
  permissions,
  rolePermissions,
  groupRoles,
  userGroups,
  userAttributes,
  agents,
  agentKeys,
  secrets,
  settings,
  oidcProviders,
  monitors,
  retentionConfig,
  refreshTokens,
  agentCommands,
  wallLayouts,
  wallDeviceGroups,
  wallDevices,
  tickerMessages,
  publicConfig,
};
