/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Admin session management routes. Operators with users:read can inspect any
 * user's active sessions; users:write can terminate them (individually or all at
 * once). Self-service session control lives in auth.routes.ts (/api/me/sessions).
 * Every mutation is audited. Routes stay thin — logic in the sessions service.
 */
import type { FastifyInstance } from "fastify";
import { bumpTokenVersion } from "@/services/auth.js";
import { listSessions, terminateAllForUser, terminateSession } from "@/services/sessions.js";

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/users/:id/sessions",
    { preHandler: [app.authenticate, app.requirePermission("users:read")] },
    async (req) => {
      const { id } = req.params as { id: string };
      return { rows: await listSessions(app.master, id) };
    },
  );

  app.post(
    "/api/users/:id/sessions/terminate",
    { preHandler: [app.authenticate, app.requirePermission("users:write")] },
    async (req) => {
      const { id } = req.params as { id: string };
      const count = await terminateAllForUser(app.master, id);
      // Bump token version too, so the user's already-issued access tokens die now.
      await bumpTokenVersion(app.master, id);
      await app.audit(req, { action: "sessions.terminate_all", category: "users", target: id, after: { count } });
      return { ok: true, count };
    },
  );

  app.delete(
    "/api/sessions/:id",
    { preHandler: [app.authenticate, app.requirePermission("users:write")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const ok = await terminateSession(app.master, id);
      if (!ok) return reply.code(404).send({ error: "not_found" });
      await app.audit(req, { action: "session.terminate", category: "users", target: id });
      return { ok: true };
    },
  );
}
