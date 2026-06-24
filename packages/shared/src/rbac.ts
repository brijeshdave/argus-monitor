/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * RBAC + ABAC contracts. Design rules enforced everywhere (see docs/adr/0004):
 *   • Users get access ONLY through GROUPS.
 *   • GROUPS carry one or more ROLES.
 *   • ROLES carry PERMISSIONS. No user→role or user→permission direct edges.
 *   • ABAC attributes refine access (e.g. tag/site scoping) on top of RBAC.
 *   • `superadmin` role + the bootstrap superadmin user are `system` = immutable.
 *
 * The permission catalogue is a flat `resource:action` string set so new monitor
 * types and features can register permissions without a schema change.
 */

/** Built-in seed roles. Custom roles may be created in the UI; these are seeded. */
export const SYSTEM_ROLES = ["superadmin", "admin", "operator", "viewer"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** A permission is `resource:action`, e.g. "agents:restart", "users:write". */
export type Permission = `${string}:${string}`;

export interface Role {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;        // system roles cannot be edited or deleted
  permissions: Permission[];
}

export interface Group {
  id: string;
  name: string;
  description: string;
  roleIds: string[];        // a group may hold multiple roles
}

// ---------------------------------------------------------------------------
// Seed catalogue — the single source of truth for the built-in permissions,
// system roles and default groups. Both the DB seed and the frontend import
// these, so there is exactly one place to add a capability (DRY).
// ---------------------------------------------------------------------------

/** Every built-in permission, grouped by resource for readability. */
export const PERMISSION_CATALOGUE = {
  dashboard: ["dashboard:read"],
  monitors: ["monitors:read", "monitors:write", "monitors:delete"],
  agents: [
    "agents:read", "agents:write",
    "agents:restart", "agents:update", "agents:delete",
  ],
  events: ["events:read"],
  logs: ["logs:read"],
  uptime: ["uptime:read"],
  audit: ["audit:read"],
  reports: ["reports:read", "reports:generate"],
  notifications: ["notifications:read", "notifications:ack"],
  users: ["users:read", "users:write", "users:delete"],
  groups: ["groups:read", "groups:write", "groups:delete"],
  roles: ["roles:read", "roles:write", "roles:delete"],
  settings: ["settings:read", "settings:write"],
  public: ["public:read", "public:write"],
  wallboards: ["wallboards:read", "wallboards:write", "wallboards:delete"],
  devices: ["devices:read", "devices:write", "devices:delete"],
  ticker: ["ticker:read", "ticker:write"],
  retention: ["retention:read", "retention:write"],
  backups: ["backups:read", "backups:run", "backups:restore"],
  developer: ["developer:read"],
} as const satisfies Record<string, readonly Permission[]>;

/** Flat list of all permission keys (derived — never hand-maintained). */
export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSION_CATALOGUE).flat();

/** The resource ("agents") part of a permission key ("agents:restart"). */
export type PermissionResource = keyof typeof PERMISSION_CATALOGUE;

/**
 * Human-friendly metadata for each permission resource, used to render the
 * permission picker (tab label + helper text) and seed nicer descriptions. The
 * key order here is also the tab order in the UI. One source of truth (DRY): add
 * a resource to PERMISSION_CATALOGUE and to RESOURCE_META in the same change.
 */
export const RESOURCE_META: Record<PermissionResource, { label: string; description: string }> = {
  dashboard: { label: "Dashboard", description: "The live operations dashboard." },
  monitors: { label: "Monitors", description: "Monitored services, hosts, databases, NAS and SNMP." },
  agents: { label: "Agents", description: "Host agents, connection keys and remote commands." },
  events: { label: "Events", description: "The durable status / client event history." },
  logs: { label: "Logs", description: "Collected and categorised log streams." },
  uptime: { label: "Uptime", description: "Uptime history and SLA reporting." },
  audit: { label: "Audit", description: "The audit trail of every mutation." },
  reports: { label: "Reports", description: "Operational reports — viewing and generation." },
  notifications: { label: "Notifications", description: "Alerts and their acknowledgement." },
  users: { label: "Users", description: "User accounts and their group membership." },
  groups: { label: "Groups", description: "Groups — the only bridge from users to roles." },
  roles: { label: "Roles", description: "Roles and the permissions they grant." },
  settings: { label: "Settings", description: "Platform settings, OIDC / SSO providers." },
  public: { label: "Public status", description: "The public, unauthenticated status page." },
  wallboards: { label: "Wallboards", description: "NOC wallboards and their layouts." },
  devices: { label: "Display devices", description: "Paired wall displays and device groups." },
  ticker: { label: "Ticker", description: "Scrolling ticker announcements." },
  retention: { label: "Retention", description: "Data retention windows and pruning." },
  backups: { label: "Backups", description: "Backups — running, restoring and scheduling." },
  developer: { label: "Developer", description: "The in-app developer documentation (/developers)." },
};

/** Friendly one-line description per permission key (drives tooltips + seed). */
export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  "dashboard:read": "View the live dashboard.",
  "monitors:read": "View monitors and their configuration.",
  "monitors:write": "Create and edit monitors (incl. scans, SNMP profiles).",
  "monitors:delete": "Delete monitors.",
  "agents:read": "View agents and connection keys.",
  "agents:write": "Configure agents (incl. debug mode, multi-host, keys).",
  "agents:restart": "Send a restart command to an agent.",
  "agents:update": "Trigger an agent self-update.",
  "agents:delete": "Remove an agent.",
  "events:read": "View the event history.",
  "logs:read": "View collected logs.",
  "uptime:read": "View uptime and SLA data.",
  "audit:read": "View the audit trail.",
  "reports:read": "View reports.",
  "reports:generate": "Generate / export reports.",
  "notifications:read": "View notifications.",
  "notifications:ack": "Acknowledge notifications.",
  "users:read": "View users and their sessions.",
  "users:write": "Create and edit users, manage their groups and sessions.",
  "users:delete": "Delete users.",
  "groups:read": "View groups.",
  "groups:write": "Create and edit groups and their roles.",
  "groups:delete": "Delete groups.",
  "roles:read": "View roles and permissions.",
  "roles:write": "Create and edit roles and their permissions.",
  "roles:delete": "Delete roles.",
  "settings:read": "View platform settings and SSO providers.",
  "settings:write": "Change platform settings and SSO providers.",
  "public:read": "View the public status configuration.",
  "public:write": "Edit the public status page.",
  "wallboards:read": "View wallboards.",
  "wallboards:write": "Create and edit wallboards.",
  "wallboards:delete": "Delete wallboards.",
  "devices:read": "View paired display devices.",
  "devices:write": "Pair, configure and group display devices.",
  "devices:delete": "Remove display devices.",
  "ticker:read": "View ticker messages.",
  "ticker:write": "Create, edit and tune ticker messages.",
  "retention:read": "View retention settings.",
  "retention:write": "Change retention settings.",
  "backups:read": "View backups and schedules.",
  "backups:run": "Run, delete, prune and schedule backups.",
  "backups:restore": "Restore from a backup.",
  "developer:read": "View the developer documentation (/developers).",
};

/**
 * Permissions granted to each system role. `"*"` means "all permissions" and is
 * expanded by the seed — superadmin always gets every capability, including ones
 * added later, with zero maintenance.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRole, Permission[] | "*"> = {
  superadmin: "*",
  admin: [
    "dashboard:read",
    "monitors:read", "monitors:write", "monitors:delete",
    "agents:read", "agents:write", "agents:approve", "agents:restart", "agents:update",
    "events:read", "logs:read", "uptime:read", "audit:read",
    "reports:read", "reports:generate",
    "notifications:read", "notifications:ack",
    "wallboards:read", "wallboards:write", "wallboards:delete",
    "devices:read", "devices:write", "devices:delete",
    "ticker:read", "ticker:write",
    "backups:read", "backups:run",
    "developer:read",
  ],
  operator: [
    "dashboard:read", "monitors:read", "agents:read", "agents:restart",
    "events:read", "logs:read", "uptime:read",
    "reports:read", "reports:generate",
    "notifications:read", "notifications:ack",
    "wallboards:read", "public:read",
  ],
  viewer: [
    "dashboard:read", "monitors:read", "agents:read", "events:read",
    "logs:read", "uptime:read", "reports:read", "notifications:read",
    "wallboards:read", "public:read",
  ],
};

/** Default system groups, each mapped to one system role. Seeded + immutable. */
export const SYSTEM_GROUPS: ReadonlyArray<{ name: string; description: string; role: SystemRole }> = [
  { name: "Owners", description: "Protected superadmins (holds the owner account).", role: "superadmin" },
  { name: "Administrators", description: "Full operational administration.", role: "admin" },
  { name: "Operators", description: "Day-to-day operations and reporting.", role: "operator" },
  { name: "Viewers", description: "Read-only access.", role: "viewer" },
];

/** A single ABAC attribute (subject- or resource-side), e.g. site=plant-a. */
export interface Attribute {
  key: string;
  value: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  disabled: boolean;
  isOwner: boolean;         // first superadmin — protected, never demotable
  isSystem: boolean;        // seeded superadmin — immutable
  groupIds: string[];       // access is derived from these groups only
  attributes: Attribute[];
  authProvider: "local" | "oidc";
  createdAt: string;
  lastLoginAt: string | null;
  // Password hash is NEVER serialized into this contract.
}
