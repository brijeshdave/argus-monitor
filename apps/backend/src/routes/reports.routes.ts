/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Report routes (operator-facing, RBAC-guarded, audited). Generation is gated by
 * `reports:generate`; listing/downloading by `reports:read`. Download validates
 * the file name to defeat path traversal (the service re-validates as well).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { REPORT_TYPES } from "@argus/shared";
import { buildReport, deleteReport, generateReport, listReports, readReportFile } from "@/services/reports.js";

/** Reject names that aren't a bare file (defence-in-depth; service re-validates). */
function isSafeName(name: string): boolean {
  return !name.includes("/") && !name.includes("\\") && !name.includes("..");
}

const generateBody = z.object({
  type: z.enum(REPORT_TYPES),
  scope: z.object({
    kind: z.enum(["all", "agent", "monitor"]),
    refId: z.string().optional(),
  }),
  days: z.number().int().positive().max(3650).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/reports", { preHandler: [app.authenticate, app.requirePermission("reports:generate")] }, async (req, reply) => {
    const parsed = generateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const meta = await generateReport(app.master, app.telemetry, parsed.data);
    await app.audit(req, { action: "report.generate", category: "reports", target: meta.name, after: meta });
    return meta;
  });

  // Build a report's data on the fly (no file) for in-UI preview + export.
  app.post("/api/reports/data", { preHandler: [app.authenticate, app.requirePermission("reports:read")] }, async (req, reply) => {
    const parsed = generateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    return buildReport(app.master, app.telemetry, parsed.data);
  });

  app.get("/api/reports", { preHandler: [app.authenticate, app.requirePermission("reports:read")] }, async () => ({
    rows: await listReports(),
  }));

  app.get("/api/reports/:name/download", { preHandler: [app.authenticate, app.requirePermission("reports:read")] }, async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!isSafeName(name)) return reply.code(400).send({ error: "invalid_request" });
    let buf: Buffer;
    try {
      buf = await readReportFile(name);
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply
      .header("Content-Type", "application/json")
      .header("Content-Disposition", `attachment; filename="${name}"`)
      .send(buf);
  });

  app.delete("/api/reports/:name", { preHandler: [app.authenticate, app.requirePermission("reports:generate")] }, async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!isSafeName(name)) return reply.code(400).send({ error: "invalid_request" });
    try {
      await deleteReport(name);
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
    await app.audit(req, { action: "report.delete", category: "reports", target: name });
    return { ok: true };
  });
}
