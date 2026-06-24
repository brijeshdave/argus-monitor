/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Audit plugin. `app.audit(req, input)` writes a durable, secret-redacted audit
 * row to the telemetry DB for every mutation. Redaction happens in @argus/core so
 * secrets can never reach the audit log. Actor + IP are filled from the request.
 */
import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { buildAuditEntry, type AuditEntryInput } from "@argus/core";
import { auditLog } from "@argus/db";

declare module "fastify" {
  interface FastifyInstance {
    audit: (req: FastifyRequest | null, input: AuditEntryInput) => Promise<void>;
  }
}

export default fp(async (app) => {
  app.decorate("audit", async (req: FastifyRequest | null, input: AuditEntryInput) => {
    const entry = buildAuditEntry({
      ...input,
      actor: input.actor ?? req?.subject?.userId ?? null,
      ip: input.ip ?? req?.ip ?? null,
    });
    await app.telemetry.insert(auditLog).values({
      actor: entry.actor,
      actorRole: entry.actorRole,
      action: entry.action,
      category: entry.category,
      target: entry.target,
      before: entry.before as Record<string, unknown> | null,
      after: entry.after as Record<string, unknown> | null,
      ip: entry.ip,
    });
  });
});
