/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Authorization plugin. Provides `requirePermission(action, resourceFn?)` — a
 * preHandler factory that runs the pure RBAC/ABAC evaluator from @argus/core
 * against the authenticated subject. Routes stay thin: they declare the
 * capability they need; the decision lives in one tested place.
 *
 * Display devices: a paired screen authenticates with a device token and holds a
 * few read permissions purely so it can RENDER a wallboard. It is an unattended
 * screen, not an operator, so `requirePermission` DENIES device tokens by default —
 * secure by default, no route can forget to guard itself. The handful of endpoints a
 * board legitimately needs opt in with `{ allowDevice: true }`.
 */
import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { authorize, type ResourceContext } from "@argus/core";
import { isDeviceSubject } from "@/services/subject.js";

type ResourceFn = (req: FastifyRequest) => ResourceContext | undefined;

/** Options for requirePermission. */
export interface RequirePermissionOpts {
  /** Allow paired display devices (wallboard rendering). Default: false. */
  allowDevice?: boolean;
  resource?: ResourceFn;
}

declare module "fastify" {
  interface FastifyInstance {
    requirePermission: (action: string, opts?: ResourceFn | RequirePermissionOpts) => preHandlerHookHandler;
  }
}

export default fp(async (app) => {
  app.decorate("requirePermission", (action: string, opts?: ResourceFn | RequirePermissionOpts) => {
    // Back-compat: the second arg used to be a bare ResourceFn.
    const o: RequirePermissionOpts = typeof opts === "function" ? { resource: opts } : (opts ?? {});

    return async (req: FastifyRequest, reply: FastifyReply) => {
      const subject = req.subject;
      if (!subject) return reply.code(401).send({ error: "unauthorized" });

      // A display device may only touch endpoints that explicitly allow it.
      if (!o.allowDevice && isDeviceSubject(subject)) {
        return reply.code(403).send({ error: "forbidden", reason: "device_not_allowed" });
      }

      const result = authorize(subject, action, o.resource?.(req));
      if (!result.allowed) {
        return reply.code(403).send({ error: "forbidden", reason: result.reason });
      }
    };
  });
});
