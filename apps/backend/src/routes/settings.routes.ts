/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Settings routes. Exposes a thin REST surface over the `settings` key/value table.
 * GET endpoints require `settings:read`; the PUT endpoint requires `settings:write`.
 * Every mutation is audited.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAllSettings, getSetting, setSetting } from "@/services/settings.js";

const putBody = z.object({
  // Accept any JSON-serialisable value — validated by the jsonb column at the DB layer.
  value: z.unknown(),
});

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  /** Return all settings as a flat key→value map. */
  app.get(
    "/api/settings",
    { preHandler: [app.authenticate, app.requirePermission("settings:read")] },
    async () => {
      const settingsMap = await getAllSettings(app.master);
      return { settings: settingsMap };
    },
  );

  /** Return a single setting by key; 404 when the key has never been set. */
  app.get(
    "/api/settings/:key",
    { preHandler: [app.authenticate, app.requirePermission("settings:read")] },
    async (req, reply) => {
      const { key } = req.params as { key: string };
      const value = await getSetting(app.master, key);
      if (value === undefined) return reply.code(404).send({ error: "not_found" });
      return { key, value };
    },
  );

  /** Upsert a setting. Any JSON value is accepted; the key is the URL param. */
  app.put(
    "/api/settings/:key",
    { preHandler: [app.authenticate, app.requirePermission("settings:write")] },
    async (req, reply) => {
      const { key } = req.params as { key: string };
      const parsed = putBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
      }
      const { value } = parsed.data;
      await setSetting(app.master, key, value);
      await app.audit(req, {
        action: "settings.update",
        category: "settings",
        target: key,
        after: { key, value },
      });
      return { key, value };
    },
  );
}
