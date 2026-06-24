/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Worker entrypoint. Two execution modes (see docs/adr/0005):
 *   • Redis enabled  → BullMQ workers consume queues; this process can run on a
 *                      SEPARATE machine for horizontal scale.
 *   • Redis disabled → the backend runs jobs in-process; this standalone worker
 *                      is unnecessary (single-node mode).
 *
 * Regardless of Redis, a lightweight in-process scheduler runs scheduled database
 * backups: every 10 minutes it reads the `backups.schedule` setting and, if due,
 * writes a new FK-ordered bundle (reusing @argus/db's exportDatabases — never a
 * duplicated dump) and prunes old files. File naming matches the backend service
 * so both share BACKUP_DIR.
 */
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import pino from "pino";
import {
  createMasterConnection,
  createTelemetryConnection,
  exportDatabasesToFile,
  settings,
  type BackupScope,
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
} from "@argus/shared";

const log = pino({ level: process.env.LOG_LEVEL ?? "info", name: "argus-workers" });

const BACKUP_DIR = resolve(`${process.env.DATA_DIR ?? "./data"}/backups`);
const FILE_PREFIX = "argus-backup-";
const TICK_MS = 5 * 60 * 1000; // re-check the schedules every 5 minutes

/** Read a settings value straight from the table (workers avoids a drizzle dep). */
async function readSetting(master: MasterDb, key: string): Promise<unknown> {
  const rows = await master.select().from(settings);
  return rows.find((r) => r.key === key)?.value;
}

/** Read all automatic-backup schedules (migrating a legacy single schedule). */
async function readSchedules(master: MasterDb): Promise<BackupSchedule[]> {
  const raw = await readSetting(master, BACKUP_SCHEDULES_KEY);
  if (Array.isArray(raw)) return raw as BackupSchedule[];
  const legacy = await readSetting(master, BACKUP_SCHEDULE_KEY);
  return legacy && typeof legacy === "object" ? [legacy as BackupSchedule] : [];
}

/** Read the global retention policy (with defaults). */
async function readRetention(master: MasterDb): Promise<BackupRetention> {
  const raw = (await readSetting(master, BACKUP_RETENTION_KEY)) as Partial<BackupRetention> | undefined;
  return { ...DEFAULT_BACKUP_RETENTION, ...(raw ?? {}) };
}

/** Infer a backup's scope from its file name (legacy names = "all"). */
function scopeFromName(name: string): BackupMeta["scope"] {
  const seg = name.slice(FILE_PREFIX.length).split("-")[0];
  return (BACKUP_SCOPES as readonly string[]).includes(seg ?? "") ? (seg as BackupMeta["scope"]) : "all";
}

/** List backup files as metadata (newest first). */
async function listBackups(): Promise<BackupMeta[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(BACKUP_DIR);
  } catch {
    return [];
  }
  const metas: BackupMeta[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const stat = await fs.stat(join(BACKUP_DIR, name));
    metas.push({ name, size: stat.size, createdAt: stat.mtime.toISOString(), scope: scopeFromName(name) });
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Newest backup file's mtime (ms) for a given scope, or 0 when none exist. */
async function newestBackupMtime(scope: BackupSchedule["scope"]): Promise<number> {
  const all = await listBackups();
  const newest = all.find((b) => b.scope === scope);
  return newest ? new Date(newest.createdAt).getTime() : 0;
}

/** Write a scoped backup bundle (streamed; same naming as the backend service). */
async function writeBackup(master: MasterDb, telemetry: TelemetryDb, scope: BackupScope): Promise<string> {
  const createdAt = new Date().toISOString();
  const name = `${FILE_PREFIX}${scope}-${createdAt.replace(/:/g, "-")}.json`;
  const full = join(BACKUP_DIR, name);
  const tmp = `${full}.tmp`;
  await exportDatabasesToFile(master, telemetry, scope, tmp);
  await fs.rename(tmp, full);
  return name;
}

/** Prune backup copies per the global retention policy. */
async function pruneByPolicy(master: MasterDb): Promise<number> {
  const [all, policy] = await Promise.all([listBackups(), readRetention(master)]);
  const toDelete = backupsToPrune(all, policy);
  for (const name of toDelete) await fs.rm(join(BACKUP_DIR, name), { force: true });
  return toDelete.length;
}

/**
 * Is a scheduled backup due now, given the last one's time? The next run is derived
 * from the schedule's frequency (interval / daily / weekly / monthly + HH:MM). A
 * never-run schedule is always due.
 */
function isDue(sched: BackupSchedule, lastMs: number, now: Date): boolean {
  if (lastMs === 0) return true;
  if (sched.frequency === "interval") {
    return now.getTime() >= lastMs + sched.intervalHours * 60 * 60 * 1000;
  }
  // Anchored cadences: find the most recent scheduled instant at/before now; due if
  // the last backup happened before it.
  const [hh, mm] = sched.time.split(":").map((n) => Number(n));
  const target = new Date(now);
  target.setHours(hh ?? 0, mm ?? 0, 0, 0);
  if (target.getTime() > now.getTime()) target.setDate(target.getDate() - 1); // today's time not reached
  if (sched.frequency === "weekly") {
    while (target.getDay() !== sched.weekday) target.setDate(target.getDate() - 1);
  } else if (sched.frequency === "monthly") {
    for (let i = 0; i < 40; i += 1) {
      const dim = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      if (target.getDate() === Math.min(sched.dayOfMonth, dim)) break;
      target.setDate(target.getDate() - 1);
    }
  }
  return lastMs < target.getTime();
}

/** One scheduler tick: run every enabled schedule that's due, then prune by policy. */
async function tick(master: MasterDb, telemetry: TelemetryDb): Promise<void> {
  let schedules: BackupSchedule[];
  try {
    schedules = await readSchedules(master);
  } catch (err) {
    log.error({ err }, "scheduler: failed to read backup schedules");
    return;
  }
  const now = new Date();
  let wrote = false;
  for (const sched of schedules) {
    if (!sched.enabled) continue;
    try {
      const newest = await newestBackupMtime(sched.scope);
      if (!isDue(sched, newest, now)) continue;
      const name = await writeBackup(master, telemetry, sched.scope);
      wrote = true;
      log.info({ name, schedule: sched.name, scope: sched.scope }, "scheduled backup written");
    } catch (err) {
      log.error({ err, schedule: sched.name }, "scheduled backup failed");
    }
  }
  if (wrote) {
    try {
      const pruned = await pruneByPolicy(master);
      if (pruned) log.info({ pruned }, "pruned backups per retention policy");
    } catch (err) {
      log.error({ err }, "backup prune failed");
    }
  }
}

/** Start the in-process backup scheduler; returns a stop function. */
function startScheduler(): () => Promise<void> {
  const master = createMasterConnection();
  const telemetry = createTelemetryConnection();

  let running = false;
  const runTick = (): void => {
    if (running) return; // never overlap ticks
    running = true;
    void tick(master.db, telemetry.db).finally(() => {
      running = false;
    });
  };

  const interval = setInterval(runTick, TICK_MS);
  runTick(); // run once shortly after boot
  log.info({ dir: BACKUP_DIR, tickMs: TICK_MS }, "backup scheduler started");

  return async () => {
    clearInterval(interval);
    await master.close();
    await telemetry.close();
  };
}

async function main() {
  const redisEnabled = (process.env.REDIS_ENABLED ?? "false").toLowerCase() === "true";

  // The backup scheduler runs in BOTH modes (it owns no queue).
  const stopScheduler = startScheduler();

  if (!redisEnabled) {
    log.warn("REDIS_ENABLED=false — standalone queue workers are a no-op; the backend runs jobs in-process.");
  } else {
    log.info({ redis: process.env.REDIS_URL }, "starting BullMQ workers");
    // Register queue processors here.
  }

  const shutdown = (signal: string) => {
    log.info({ signal }, "workers shutting down");
    void stopScheduler().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Keep the process alive (the interval would normally suffice, but be explicit).
  setInterval(() => {}, 1 << 30);
}

void main();
