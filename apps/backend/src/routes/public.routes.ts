/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Public status-page routes. ONE endpoint is unauthenticated by design — the
 * public status snapshot (coarse, whitelisted fields only; relies on the global
 * rate-limit). The config endpoints are operator-facing and RBAC-guarded.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  buildPublicStatus,
  getPublicConfig,
  updatePublicConfig,
} from "@/services/public-status.js";

const configSchema = z.object({
  enabled: z.boolean(),
  title: z.string().min(1),
  description: z.string().max(2000).optional(),
  showUptime: z.boolean(),
  showHistory: z.boolean(),
  historyDays: z.number().int().min(1).max(365),
  notice: z.object({ level: z.enum(["info", "maintenance", "incident"]), message: z.string().max(2000) }).optional(),
  items: z.array(
    z.object({
      kind: z.enum(["agent", "monitor"]),
      refId: z.string().min(1),
      label: z.string().min(1),
      group: z.string().max(120).optional(),
    }),
  ),
});

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  // ── PUBLIC: unauthenticated status snapshot (rate-limited globally) ─────────
  app.get("/api/public/status", async (_req, reply) => {
    const status = await buildPublicStatus(app.master, app.telemetry);
    if (!status) return reply.code(404).send({ error: "disabled" });
    return status;
  });

  // ── ADMIN: read the operator-facing config ─────────────────────────────────
  app.get(
    "/api/public/config",
    { preHandler: [app.authenticate, app.requirePermission("public:read")] },
    async () => getPublicConfig(app.master),
  );

  // ── ADMIN: upsert the operator-facing config ───────────────────────────────
  app.put(
    "/api/public/config",
    { preHandler: [app.authenticate, app.requirePermission("public:write")] },
    async (req, reply) => {
      const parsed = configSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
      }
      const dto = await updatePublicConfig(app.master, parsed.data);
      await app.audit(req, { action: "public.config.update", category: "public", after: dto });
      return dto;
    },
  );
}
