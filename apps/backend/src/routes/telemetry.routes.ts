/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Read-only observability routes (RBAC-guarded): audit, logs, status events,
 * notifications (+ ack) and uptime. Pagination via ?limit&offset.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  acknowledgeNotification, listAudit, listEvents, listLogs, listNotifications, listUptime,
} from "@/services/telemetry.js";

const pageQ = z.object({
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
  sort: z.enum(["asc", "desc"]).optional(),
});

export async function telemetryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/audit", { preHandler: [app.authenticate, app.requirePermission("audit:read")] }, async (req) => {
    const q = pageQ.extend({ category: z.string().optional(), action: z.string().optional(), actor: z.string().optional() }).parse(req.query);
    return listAudit(app.master, app.telemetry, q);
  });

  app.get("/api/logs", { preHandler: [app.authenticate, app.requirePermission("logs:read")] }, async (req) => {
    const q = pageQ.extend({ category: z.string().optional(), level: z.string().optional(), sourceId: z.string().optional() }).parse(req.query);
    return listLogs(app.master, app.telemetry, q);
  });

  app.get("/api/events", { preHandler: [app.authenticate, app.requirePermission("events:read")] }, async (req) => {
    const q = pageQ.extend({ sourceId: z.string().optional(), entity: z.string().optional() }).parse(req.query);
    return listEvents(app.master, app.telemetry, q);
  });

  app.get("/api/notifications", { preHandler: [app.authenticate, app.requirePermission("notifications:read")] }, async (req) => {
    const q = pageQ.extend({ severity: z.string().optional(), acknowledged: z.coerce.boolean().optional(), sourceId: z.string().optional() }).parse(req.query);
    return listNotifications(app.master, app.telemetry, q);
  });

  app.patch("/api/notifications/:id/ack", { preHandler: [app.authenticate, app.requirePermission("notifications:ack")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await acknowledgeNotification(app.telemetry, id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  app.get("/api/uptime", { preHandler: [app.authenticate, app.requirePermission("uptime:read")] }, async (req) => {
    const q = z.object({ sourceId: z.string().optional(), entity: z.string().optional(), hours: z.coerce.number().int().positive().optional() }).parse(req.query);
    const from = q.hours ? new Date(Date.now() - q.hours * 3600 * 1000).toISOString() : undefined;
    return listUptime(app.telemetry, { sourceId: q.sourceId, entity: q.entity, from });
  });
}
