/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Backup/restore routes (operator-facing, RBAC-guarded, audited). Restore is
 * DESTRUCTIVE — it replaces the captured scope — so it is gated by `backups:restore`
 * and always audited. Backups are run on a chosen scope, retained by a global
 * policy (per-scope last-N + GFS daily/weekly/monthly), and prunable on demand.
 * Download/restore/delete validate the file name to defeat traversal.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BACKUP_FREQUENCIES, BACKUP_SCOPES } from "@argus/shared";
import {
  deleteBackup,
  listBackups,
  pruneByPolicy,
  readBackupFile,
  readRetention,
  readSchedules,
  restoreBackup,
  runBackup,
  writeRetention,
  writeSchedules,
} from "@/services/backup.js";

/** Reject names that aren't a bare file (defence-in-depth; service re-validates). */
function isSafeName(name: string): boolean {
  return !name.includes("/") && !name.includes("\\") && !name.includes("..");
}

const scheduleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  enabled: z.boolean(),
  scope: z.enum(BACKUP_SCOPES),
  frequency: z.enum(BACKUP_FREQUENCIES),
  intervalHours: z.number().int().positive(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekday: z.number().int().min(0).max(6),
  dayOfMonth: z.number().int().min(1).max(31),
});

const retentionSchema = z.object({
  keepAll: z.number().int().min(0),
  keepConfig: z.number().int().min(0),
  keepData: z.number().int().min(0),
  daily: z.number().int().min(0),
  weekly: z.number().int().min(0),
  monthly: z.number().int().min(0),
});

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/backups", { preHandler: [app.authenticate, app.requirePermission("backups:run")] }, async (req) => {
    const parsed = z.object({ scope: z.enum(BACKUP_SCOPES).optional() }).safeParse(req.body ?? {});
    const scope = parsed.success ? parsed.data.scope ?? "all" : "all";
    const meta = await runBackup(app.master, app.telemetry, scope);
    await app.audit(req, { action: "backup.create", category: "backups", target: meta.name, after: meta });
    return meta;
  });

  app.get("/api/backups", { preHandler: [app.authenticate, app.requirePermission("backups:read")] }, async () => ({
    rows: await listBackups(),
  }));

  app.get("/api/backups/:name/download", { preHandler: [app.authenticate, app.requirePermission("backups:read")] }, async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!isSafeName(name)) return reply.code(400).send({ error: "invalid_request" });
    let buf: Buffer;
    try {
      buf = await readBackupFile(name);
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply
      .header("Content-Type", "application/json")
      .header("Content-Disposition", `attachment; filename="${name}"`)
      .send(buf);
  });

  app.delete("/api/backups/:name", { preHandler: [app.authenticate, app.requirePermission("backups:run")] }, async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!isSafeName(name)) return reply.code(400).send({ error: "invalid_request" });
    const ok = await deleteBackup(name);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "backup.delete", category: "backups", target: name });
    return { ok: true };
  });

  app.post("/api/backups/prune", { preHandler: [app.authenticate, app.requirePermission("backups:run")] }, async (req) => {
    const deleted = await pruneByPolicy(app.master);
    if (deleted.length) await app.audit(req, { action: "backup.prune", category: "backups", target: "retention", after: { deleted } });
    return { deleted };
  });

  app.post("/api/backups/:name/restore", { preHandler: [app.authenticate, app.requirePermission("backups:restore")] }, async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!isSafeName(name)) return reply.code(400).send({ error: "invalid_request" });
    try {
      await restoreBackup(app.master, app.telemetry, name);
    } catch (err) {
      app.log.error({ err, name }, "backup restore failed");
      return reply.code(400).send({ error: "restore_failed" });
    }
    // DESTRUCTIVE action — always audited.
    await app.audit(req, { action: "backup.restore", category: "backups", target: name });
    return { ok: true };
  });

  // ── Schedules (a list) ──────────────────────────────────────────────────
  app.get("/api/backups/schedules", { preHandler: [app.authenticate, app.requirePermission("backups:read")] }, async () => ({
    schedules: await readSchedules(app.master),
  }));

  app.put("/api/backups/schedules", { preHandler: [app.authenticate, app.requirePermission("backups:run")] }, async (req, reply) => {
    const parsed = z.object({ schedules: z.array(scheduleSchema).max(50) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const saved = await writeSchedules(app.master, parsed.data.schedules);
    await app.audit(req, { action: "backup.schedules", category: "backups", target: "schedules", after: { count: saved.length } });
    return { schedules: saved };
  });

  // ── Retention policy ────────────────────────────────────────────────────
  app.get("/api/backups/retention", { preHandler: [app.authenticate, app.requirePermission("backups:read")] }, async () => ({
    retention: await readRetention(app.master),
  }));

  app.put("/api/backups/retention", { preHandler: [app.authenticate, app.requirePermission("backups:run")] }, async (req, reply) => {
    const parsed = retentionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    await writeRetention(app.master, parsed.data);
    await app.audit(req, { action: "backup.retention", category: "backups", target: "retention", after: parsed.data });
    return { retention: parsed.data };
  });
}
