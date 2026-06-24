/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * User management routes. Every route is permission-guarded (RBAC) and every
 * mutation is audited. Protected (owner/system) users are rejected by the service
 * layer. This file is the pattern the other RBAC-admin routes follow.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ProtectedEntityError } from "@argus/core";
import { bumpTokenVersion } from "@/services/auth.js";
import { clearLock } from "@/services/lockout.js";
import {
  createUser, deleteUser, getUser, listUsers, setUserAttributes, setUserGroups, updateUser,
} from "@/services/users.js";
import { resetFor } from "@/services/twofa.js";

const attribute = z.object({ key: z.string().min(1), value: z.string() });
const createBody = z.object({
  username: z.string().min(1),
  displayName: z.string().optional(),
  email: z.string().email().nullable().optional(),
  password: z.string().min(8),
  groupIds: z.array(z.string()).optional(),
  attributes: z.array(attribute).optional(),
});
const updateBody = z.object({
  displayName: z.string().optional(),
  email: z.string().email().nullable().optional(),
  disabled: z.boolean().optional(),
  password: z.string().min(8).optional(),
});
const groupsBody = z.object({ groupIds: z.array(z.string()) });
const attributesBody = z.object({ attributes: z.array(attribute) });

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/users", { preHandler: [app.authenticate, app.requirePermission("users:read")] }, async () => {
    return { rows: await listUsers(app.master) };
  });

  app.post("/api/users", { preHandler: [app.authenticate, app.requirePermission("users:write")] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const user = await createUser(app.master, parsed.data);
    await app.audit(req, { action: "user.create", category: "users", target: user?.id ?? null, after: user });
    return reply.code(201).send({ user });
  });

  app.patch("/api/users/:id", { preHandler: [app.authenticate, app.requirePermission("users:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    try {
      const user = await updateUser(app.master, id, parsed.data);
      if (!user) return reply.code(404).send({ error: "not_found" });
      await app.audit(req, { action: "user.update", category: "users", target: id, after: user });
      return { user };
    } catch (err) {
      if (err instanceof ProtectedEntityError) return reply.code(403).send({ error: "protected_entity" });
      throw err;
    }
  });

  app.delete("/api/users/:id", { preHandler: [app.authenticate, app.requirePermission("users:delete")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const ok = await deleteUser(app.master, id);
      if (!ok) return reply.code(404).send({ error: "not_found" });
      await app.audit(req, { action: "user.delete", category: "users", target: id });
      return { ok: true };
    } catch (err) {
      if (err instanceof ProtectedEntityError) return reply.code(403).send({ error: "protected_entity" });
      throw err;
    }
  });

  app.put("/api/users/:id/groups", { preHandler: [app.authenticate, app.requirePermission("users:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = groupsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    await setUserGroups(app.master, id, parsed.data.groupIds);
    await app.audit(req, { action: "user.set_groups", category: "users", target: id, after: parsed.data });
    return { ok: true };
  });

  app.put("/api/users/:id/attributes", { preHandler: [app.authenticate, app.requirePermission("users:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = attributesBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const target = await getUser(app.master, id);
    if (!target) return reply.code(404).send({ error: "not_found" });
    await setUserAttributes(app.master, id, parsed.data.attributes);
    await app.audit(req, { action: "user.set_attributes", category: "users", target: id, after: parsed.data });
    return { ok: true };
  });

  app.post("/api/users/:id/2fa/reset", { preHandler: [app.authenticate, app.requirePermission("users:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const target = await getUser(app.master, id);
    if (!target) return reply.code(404).send({ error: "not_found" });
    await resetFor(app.master, id);
    // A 2FA reset is a security change → kick all the user's sessions immediately
    // and clear any active login lockout.
    await bumpTokenVersion(app.master, id);
    await clearLock(app.master, id);
    await app.audit(req, { action: "2fa.reset", category: "users", target: id });
    return { ok: true };
  });

  app.post("/api/users/:id/unlock", { preHandler: [app.authenticate, app.requirePermission("users:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const target = await getUser(app.master, id);
    if (!target) return reply.code(404).send({ error: "not_found" });
    await clearLock(app.master, id);
    await app.audit(req, { action: "user.unlock", category: "users", target: id });
    return { ok: true };
  });
}
