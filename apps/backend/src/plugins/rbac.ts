/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Authorization plugin. Provides `requirePermission(action, resourceFn?)` — a
 * preHandler factory that runs the pure RBAC/ABAC evaluator from @argus/core
 * against the authenticated subject. Routes stay thin: they declare the
 * capability they need; the decision lives in one tested place.
 */
import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { authorize, type ResourceContext } from "@argus/core";

type ResourceFn = (req: FastifyRequest) => ResourceContext | undefined;

declare module "fastify" {
  interface FastifyInstance {
    requirePermission: (action: string, resourceFn?: ResourceFn) => preHandlerHookHandler;
  }
}

export default fp(async (app) => {
  app.decorate("requirePermission", (action: string, resourceFn?: ResourceFn) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const subject = req.subject;
      if (!subject) return reply.code(401).send({ error: "unauthorized" });
      const result = authorize(subject, action, resourceFn?.(req));
      if (!result.allowed) {
        return reply.code(403).send({ error: "forbidden", reason: result.reason });
      }
    };
  });
});
