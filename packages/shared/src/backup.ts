/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Backup contracts shared by backend, workers and frontend. A backup has a SCOPE
 * (what it captures) and the automatic policy has a SCHEDULE (when it runs). Both
 * the on-demand and scheduled paths use these shapes so the meaning never drifts.
 */

/** What a backup bundle captures. config = master DB (identity/RBAC/config/secrets);
 * data = telemetry DB (metrics/events/logs/audit); all = both. */
export const BACKUP_SCOPES = ["all", "config", "data"] as const;
export type BackupScope = (typeof BACKUP_SCOPES)[number];

/** Human label for a scope (UI + filenames). */
export function backupScopeLabel(scope: BackupScope): string {
  return scope === "config" ? "Config only" : scope === "data" ? "Data only" : "Config + data";
}

/** Metadata describing one backup file on disk. */
export interface BackupMeta {
  name: string;
  size: number;
  createdAt: string;
  scope: BackupScope;
}

/** How often an automatic backup runs. */
export const BACKUP_FREQUENCIES = ["interval", "daily", "weekly", "monthly"] as const;
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];

/**
 * One automatic-backup schedule. The fleet can hold MANY (e.g. one config-only and
 * one data-only on different cadences). `frequency` selects the timing fields:
 *   interval → every `intervalHours`
 *   daily    → every day at `time`
 *   weekly   → on `weekday` (0=Sun…6=Sat) at `time`
 *   monthly  → on `dayOfMonth` (1–31, clamped to month length) at `time`
 * Retention is NOT per-schedule — copies are pruned by the global {@link BackupRetention}.
 */
export interface BackupSchedule {
  id: string;
  name: string;
  enabled: boolean;
  scope: BackupScope;
  frequency: BackupFrequency;
  intervalHours: number;
  time: string; // "HH:MM" (24h, server-local) for daily/weekly/monthly
  weekday: number; // 0–6 for weekly
  dayOfMonth: number; // 1–31 for monthly
}

/** Settings keys: the schedule LIST and the global retention policy. */
export const BACKUP_SCHEDULES_KEY = "backups.schedules";
export const BACKUP_RETENTION_KEY = "backups.retention";
/** Legacy single-schedule key (pre-multi-schedule) — migrated on read. */
export const BACKUP_SCHEDULE_KEY = "backups.schedule";

/** A fresh schedule with safe defaults (id assigned by the caller). */
export function newBackupSchedule(id: string): BackupSchedule {
  return { id, name: "New schedule", enabled: false, scope: "all", frequency: "daily", intervalHours: 24, time: "02:00", weekday: 0, dayOfMonth: 1 };
}

/**
 * Global retention policy for backup COPIES. A backup survives if ANY rule protects
 * it. Tiers are evaluated PER SCOPE so config/data/full are retained independently:
 *   keep{All,Config,Data} → always keep the newest N of that scope
 *   daily/weekly/monthly  → keep the newest bundle in each of the last N day/ISO-week/
 *                            month buckets (grandfather-father-son). 0 disables a rule.
 */
export interface BackupRetention {
  keepAll: number;
  keepConfig: number;
  keepData: number;
  daily: number;
  weekly: number;
  monthly: number;
}

export const DEFAULT_BACKUP_RETENTION: BackupRetention = {
  keepAll: 3,
  keepConfig: 3,
  keepData: 3,
  daily: 10,
  weekly: 5,
  monthly: 3,
};

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** One-line human summary of a schedule (UI). */
export function describeBackupSchedule(s: BackupSchedule): string {
  const prefix = s.enabled ? "" : "(disabled) ";
  switch (s.frequency) {
    case "interval":
      return `${prefix}Every ${s.intervalHours} hour${s.intervalHours === 1 ? "" : "s"}`;
    case "daily":
      return `${prefix}Daily at ${s.time}`;
    case "weekly":
      return `${prefix}Weekly on ${WEEKDAY_NAMES[s.weekday] ?? "Sunday"} at ${s.time}`;
    case "monthly":
      return `${prefix}Monthly on day ${s.dayOfMonth} at ${s.time}`;
    default:
      return `${prefix}Disabled`;
  }
}

// ── Retention selection (pure; shared by backend + workers, unit-tested) ──────

/** UTC calendar-day key, e.g. "2026-06-23". */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** UTC ISO-week key, e.g. "2026-W26". */
function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // ISO 8601: week belongs to the year of its Thursday; week 1 contains Jan 4th.
  const day = (t.getUTCDay() + 6) % 7; // Mon=0…Sun=6
  t.setUTCDate(t.getUTCDate() - day + 3); // move to Thursday
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** UTC month key, e.g. "2026-06". */
function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** Keep the newest backup in each of the most-recent `count` buckets. */
function protectBuckets(sortedDesc: BackupMeta[], count: number, keyOf: (d: Date) => string, keep: Set<string>): void {
  if (count <= 0) return;
  const newestPerBucket = new Map<string, string>(); // bucket → newest backup name (first seen = newest)
  for (const b of sortedDesc) {
    const k = keyOf(new Date(b.createdAt));
    if (!newestPerBucket.has(k)) newestPerBucket.set(k, b.name);
  }
  let i = 0;
  for (const name of newestPerBucket.values()) {
    if (i++ >= count) break;
    keep.add(name);
  }
}

/**
 * Given all backups and a retention policy, return the names that should be DELETED.
 * Pure + deterministic — the system of record for "manage backup copies".
 */
export function backupsToPrune(backups: BackupMeta[], policy: BackupRetention): string[] {
  const keep = new Set<string>();
  const keepLatest: Record<BackupScope, number> = { all: policy.keepAll, config: policy.keepConfig, data: policy.keepData };

  for (const scope of BACKUP_SCOPES) {
    const list = backups
      .filter((b) => b.scope === scope)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
    list.slice(0, Math.max(0, keepLatest[scope])).forEach((b) => keep.add(b.name));
    protectBuckets(list, policy.daily, dayKey, keep);
    protectBuckets(list, policy.weekly, weekKey, keep);
    protectBuckets(list, policy.monthly, monthKey, keep);
  }
  return backups.filter((b) => !keep.has(b.name)).map((b) => b.name);
}
