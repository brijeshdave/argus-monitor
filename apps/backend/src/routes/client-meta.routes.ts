/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Client-metadata routes (operator-facing, RBAC-guarded, audited): per-IP custom
 * name + description for connected clients. Read with monitors:read, edit with
 * monitors:write (clients are part of the monitoring picture).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { deleteClientMeta, listClientMeta, upsertClientMeta } from "@/services/client-meta.js";

export async function clientMetaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/client-meta", { preHandler: [app.authenticate, app.requirePermission("monitors:read")] }, async () => ({
    rows: await listClientMeta(app.master),
  }));

  app.put("/api/client-meta/:ip", { preHandler: [app.authenticate, app.requirePermission("monitors:write")] }, async (req, reply) => {
    const { ip } = req.params as { ip: string };
    const parsed = z.object({ hostname: z.string().nullable().optional(), description: z.string().nullable().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const updatedBy = (req.user as { username?: string } | undefined)?.username ?? null;
    const meta = await upsertClientMeta(app.master, ip, parsed.data, updatedBy);
    await app.audit(req, { action: "clientmeta.upsert", category: "monitors", target: ip, after: { ...meta } });
    return { meta };
  });

  app.delete("/api/client-meta/:ip", { preHandler: [app.authenticate, app.requirePermission("monitors:write")] }, async (req, reply) => {
    const { ip } = req.params as { ip: string };
    const ok = await deleteClientMeta(app.master, ip);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "clientmeta.delete", category: "monitors", target: ip });
    return { ok: true };
  });
}
