/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Backup service: writes/reads/restores logical backup bundles on local disk and
 * manages the (optional) scheduled-backup policy. The heavy lifting (FK-ordered
 * dump/restore) lives in @argus/db so the workers process can reuse it without
 * depending on the backend. Restores validate the file path is inside BACKUP_DIR
 * to defeat path traversal.
 */
import { promises as fs } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import {
  exportDatabasesToFile,
  importDatabases,
  type BackupBundle,
  type MasterDb,
  type TelemetryDb,
} from "@argus/db";
import {
  BACKUP_RETENTION_KEY,
  BACKUP_SCHEDULE_KEY,
  BACKUP_SCHEDULES_KEY,
  BACKUP_SCOPES,
  backupsToPrune,
  DEFAULT_BACKUP_RETENTION,
  type BackupMeta,
  type BackupRetention,
  type BackupSchedule,
  type BackupScope,
} from "@argus/shared";
import { getSetting, setSetting } from "@/services/settings.js";

/** Directory where backup bundles live (under DATA_DIR; created on first write). */
export const BACKUP_DIR = resolve(`${process.env.DATA_DIR ?? "./data"}/backups`);

const FILE_PREFIX = "argus-backup-";

export type { BackupMeta, BackupSchedule, BackupScope, BackupRetention } from "@argus/shared";

/** Sanitise/normalise one schedule from persisted (untrusted) JSON. */
function normalizeSchedule(raw: Partial<BackupSchedule>, idx: number): BackupSchedule {
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `sched-${idx}-${Date.now()}`,
    name: typeof raw.name === "string" && raw.name ? raw.name : "Backup schedule",
    enabled: Boolean(raw.enabled),
    scope: (BACKUP_SCOPES as readonly string[]).includes(raw.scope as string) ? (raw.scope as BackupScope) : "all",
    frequency: (["interval", "daily", "weekly", "monthly"].includes(raw.frequency as string) ? raw.frequency : "daily") as BackupSchedule["frequency"],
    intervalHours: Math.max(1, Number(raw.intervalHours ?? 24)),
    time: typeof raw.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time) ? raw.time : "02:00",
    weekday: Math.min(6, Math.max(0, Number(raw.weekday ?? 0))),
    dayOfMonth: Math.min(31, Math.max(1, Number(raw.dayOfMonth ?? 1))),
  };
}

/** Encode a scope into the file name: argus-backup-<scope>-<timestamp>.json. */
function backupFileName(createdAt: string, scope: BackupScope): string {
  return `${FILE_PREFIX}${scope}-${createdAt.replace(/:/g, "-")}.json`;
}

/** Infer a backup's scope from its file name (legacy names without a scope = "all"). */
function scopeFromName(name: string): BackupScope {
  const rest = name.slice(FILE_PREFIX.length);
  const seg = rest.split("-")[0] as BackupScope;
  return (BACKUP_SCOPES as readonly string[]).includes(seg) ? seg : "all";
}

/** Resolve a user-supplied name to an absolute path INSIDE BACKUP_DIR (or throw). */
function safeBackupPath(name: string): string {
  // Reject anything that isn't a bare *.json file name in the backup directory.
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error("invalid backup name");
  }
  const full = resolve(BACKUP_DIR, name);
  if (full !== resolve(BACKUP_DIR, basename(name)) || !full.startsWith(BACKUP_DIR + sep)) {
    throw new Error("path traversal rejected");
  }
  return full;
}

/** Export the selected scope and write the bundle to a new timestamped JSON file. */
export async function runBackup(
  master: MasterDb,
  telemetry: TelemetryDb,
  scope: BackupScope = "all",
): Promise<BackupMeta> {
  // Stream to a temp file then rename, so a partial write never appears in the list.
  const createdAt = new Date().toISOString();
  const name = backupFileName(createdAt, scope);
  const full = join(BACKUP_DIR, name);
  const tmp = `${full}.tmp`;
  const res = await exportDatabasesToFile(master, telemetry, scope, tmp);
  await fs.rename(tmp, full);
  // Enforce the retention policy after every new copy (manual or scheduled).
  await pruneByPolicy(master);
  return { name, size: res.bytes, createdAt: res.createdAt, scope };
}

/** List existing backup files (newest first), with size, creation time + scope. */
export async function listBackups(): Promise<BackupMeta[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(BACKUP_DIR);
  } catch {
    return []; // directory not created yet → no backups
  }
  const metas: BackupMeta[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const stat = await fs.stat(join(BACKUP_DIR, name));
    metas.push({ name, size: stat.size, createdAt: stat.mtime.toISOString(), scope: scopeFromName(name) });
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Read raw bytes for a named backup (path-traversal guarded) — for download. */
export async function readBackupFile(name: string): Promise<Buffer> {
  return fs.readFile(safeBackupPath(name));
}

/** Restore both databases from a named backup file (path-traversal guarded). */
export async function restoreBackup(
  master: MasterDb,
  telemetry: TelemetryDb,
  name: string,
): Promise<void> {
  const buf = await fs.readFile(safeBackupPath(name));
  const bundle = JSON.parse(buf.toString("utf8")) as BackupBundle;
  if (bundle.version !== 1) throw new Error(`unsupported backup version: ${String(bundle.version)}`);
  await importDatabases(master, telemetry, bundle);
}

/** Delete one backup file by name (path-traversal guarded). True when removed. */
export async function deleteBackup(name: string): Promise<boolean> {
  const path = safeBackupPath(name);
  try {
    await fs.rm(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prune backup COPIES per the global retention policy (per-scope last-N + GFS
 * daily/weekly/monthly). Returns the deleted file names. The selection is the pure,
 * unit-tested {@link backupsToPrune}; this only performs the file IO.
 */
export async function pruneByPolicy(master: MasterDb): Promise<string[]> {
  const [all, policy] = await Promise.all([listBackups(), readRetention(master)]);
  const toDelete = backupsToPrune(all, policy);
  for (const name of toDelete) await fs.rm(join(BACKUP_DIR, name), { force: true });
  return toDelete;
}

/**
 * Read all automatic-backup schedules. Migrates a legacy single `backups.schedule`
 * into a one-element list when the new `backups.schedules` key is absent.
 */
export async function readSchedules(master: MasterDb): Promise<BackupSchedule[]> {
  const raw = await getSetting(master, BACKUP_SCHEDULES_KEY);
  if (Array.isArray(raw)) return raw.map((r, i) => normalizeSchedule(r as Partial<BackupSchedule>, i));
  const legacy = (await getSetting(master, BACKUP_SCHEDULE_KEY)) as Partial<BackupSchedule> | undefined;
  if (legacy && typeof legacy === "object") return [normalizeSchedule({ ...legacy, name: "Migrated schedule" }, 0)];
  return [];
}

/** Persist the full schedule list. */
export async function writeSchedules(master: MasterDb, schedules: BackupSchedule[]): Promise<BackupSchedule[]> {
  const clean = schedules.map((s, i) => normalizeSchedule(s, i));
  await setSetting(master, BACKUP_SCHEDULES_KEY, clean);
  return clean;
}

/** Read the global retention policy (falls back to sane defaults). */
export async function readRetention(master: MasterDb): Promise<BackupRetention> {
  const raw = (await getSetting(master, BACKUP_RETENTION_KEY)) as Partial<BackupRetention> | undefined;
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : d);
  return {
    keepAll: n(raw?.keepAll, DEFAULT_BACKUP_RETENTION.keepAll),
    keepConfig: n(raw?.keepConfig, DEFAULT_BACKUP_RETENTION.keepConfig),
    keepData: n(raw?.keepData, DEFAULT_BACKUP_RETENTION.keepData),
    daily: n(raw?.daily, DEFAULT_BACKUP_RETENTION.daily),
    weekly: n(raw?.weekly, DEFAULT_BACKUP_RETENTION.weekly),
    monthly: n(raw?.monthly, DEFAULT_BACKUP_RETENTION.monthly),
  };
}

/** Persist the global retention policy. */
export async function writeRetention(master: MasterDb, policy: BackupRetention): Promise<void> {
  await setSetting(master, BACKUP_RETENTION_KEY, policy);
}
