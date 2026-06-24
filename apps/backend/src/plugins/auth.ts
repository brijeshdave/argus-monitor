/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Authentication plugin. Registers @fastify/jwt and an `authenticate` preHandler
 * that resolves the caller into an AuthSubject. Supports two credentials:
 *   • a JWT access token (normal users), and
 *   • the static ADMIN_TOKEN (treated as the protected owner) for CLI/automation.
 */
import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthSubject } from "@argus/core";
import { deviceSubject, resolveSubject, STATIC_ADMIN_SUBJECT } from "@/services/subject.js";
import { resolveDeviceToken } from "@/services/devices.js";
import { getTokenVersion, isSessionLive } from "@/services/auth.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    subject?: AuthSubject;
    /** Set when the caller authenticated with a display-device token (read-only). */
    deviceId?: string;
  }
}
declare module "@fastify/jwt" {
  interface FastifyJWT {
    // `sid` = the refresh-token row id active when this token was issued (the
    // session); `tv` = the user's tokenVersion at issue time. Both enable instant,
    // DB-backed revocation (see the `authenticate` preHandler). Optional so the
    // static-admin path and any legacy token still type-check.
    payload: { sub: string; sid?: string; tv?: number };
    user: { sub: string; sid?: string; tv?: number };
  }
}

export default fp(async (app) => {
  await app.register(jwt, { secret: app.config.jwtSecret });

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;

    // Static superadmin token (optional; for automation).
    if (app.config.adminToken && header === `Bearer ${app.config.adminToken}`) {
      req.subject = STATIC_ADMIN_SUBJECT;
      return;
    }

    // Display-device token (read-only): paired wallboards/TVs render via this.
    if (header?.startsWith("Bearer wd_")) {
      const device = await resolveDeviceToken(app.master, header.slice("Bearer ".length));
      if (!device) return reply.code(401).send({ error: "unauthorized" });
      req.subject = deviceSubject(device.id);
      req.deviceId = device.id;
      return;
    }

    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }

    // Instant, DB-backed revocation. A token version mismatch means a global
    // revoke happened (password change / 2FA reset / terminate-all) → kill every
    // token. A dead `sid` means that one session's refresh row was revoked or
    // expired → kill just this token. Both are checked on EVERY request.
    if (req.user.tv !== undefined) {
      const current = await getTokenVersion(app.master, req.user.sub);
      if (current === null || current !== req.user.tv) {
        return reply.code(401).send({ error: "token_revoked" });
      }
    }
    if (req.user.sid !== undefined) {
      if (!(await isSessionLive(app.master, req.user.sid))) {
        return reply.code(401).send({ error: "session_revoked" });
      }
    }

    const subject = await resolveSubject(app.master, req.user.sub);
    if (!subject) return reply.code(401).send({ error: "unauthorized" });
    req.subject = subject;
  });
});
