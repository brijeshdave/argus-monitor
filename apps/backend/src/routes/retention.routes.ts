/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Retention routes. GET requires `retention:read`; PUT requires `retention:write`.
 * The PUT endpoint validates that the `dataType` path param is one of the known
 * telemetry data types and that `days` is a non-negative integer or null.
 * Every mutation is audited.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RETENTION_DATA_TYPES } from "@argus/db";
import { listRetention, setRetention } from "@/services/retention.js";
import { runRetentionSweep } from "@/services/retention-sweeper.js";

const putBody = z.object({
  // Non-negative integer (days to keep) or null (unlimited retention).
  days: z.number().int().nonnegative().nullable(),
});

export async function retentionRoutes(app: FastifyInstance): Promise<void> {
  /** Return the retention policy for every data type. */
  app.get(
    "/api/retention",
    { preHandler: [app.authenticate, app.requirePermission("retention:read")] },
    async () => {
      const rows = await listRetention(app.master);
      return { rows };
    },
  );

  /** Upsert the retention policy for a specific data type. */
  app.put(
    "/api/retention/:dataType",
    { preHandler: [app.authenticate, app.requirePermission("retention:write")] },
    async (req, reply) => {
      const { dataType } = req.params as { dataType: string };

      // Validate that the caller is targeting a known data type.
      if (!(RETENTION_DATA_TYPES as readonly string[]).includes(dataType)) {
        return reply.code(400).send({
          error: "invalid_data_type",
          message: `Unknown data type "${dataType}". Valid types: ${RETENTION_DATA_TYPES.join(", ")}`,
        });
      }

      const parsed = putBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
      }

      const { days } = parsed.data;
      const row = await setRetention(app.master, dataType, days);

      await app.audit(req, {
        action: "retention.update",
        category: "retention",
        target: dataType,
        after: { dataType, days },
      });

      return { row };
    },
  );

  /** Run the retention sweep now (prune all data types to their windows). */
  app.post(
    "/api/retention/run",
    { preHandler: [app.authenticate, app.requirePermission("retention:write")] },
    async (req) => {
      const pruned = await runRetentionSweep(app);
      await app.audit(req, { action: "retention.run", category: "retention", target: "all", after: { pruned } });
      return { pruned };
    },
  );
}
