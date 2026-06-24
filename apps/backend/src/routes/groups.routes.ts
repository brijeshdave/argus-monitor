/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Group management routes. Every mutating route is permission-guarded (RBAC) and
 * audited. Protected (system) groups are rejected by the service layer.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ProtectedEntityError } from "@argus/core";
import {
  createGroup, deleteGroup, listGroups, setGroupRoles, updateGroup,
} from "@/services/groups.js";

const createBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  roleIds: z.array(z.string()).optional(),
});

const updateBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

const rolesBody = z.object({ roleIds: z.array(z.string()) });

export async function groupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/groups", { preHandler: [app.authenticate, app.requirePermission("groups:read")] }, async () => {
    return { rows: await listGroups(app.master) };
  });

  app.post("/api/groups", { preHandler: [app.authenticate, app.requirePermission("groups:write")] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const group = await createGroup(app.master, parsed.data);
    await app.audit(req, { action: "group.create", category: "groups", target: group?.id ?? null, after: group });
    return reply.code(201).send({ group });
  });

  app.patch("/api/groups/:id", { preHandler: [app.authenticate, app.requirePermission("groups:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    try {
      const group = await updateGroup(app.master, id, parsed.data);
      if (!group) return reply.code(404).send({ error: "not_found" });
      await app.audit(req, { action: "group.update", category: "groups", target: id, after: group });
      return { group };
    } catch (err) {
      if (err instanceof ProtectedEntityError) return reply.code(403).send({ error: "protected_entity" });
      throw err;
    }
  });

  app.delete("/api/groups/:id", { preHandler: [app.authenticate, app.requirePermission("groups:delete")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const ok = await deleteGroup(app.master, id);
      if (!ok) return reply.code(404).send({ error: "not_found" });
      await app.audit(req, { action: "group.delete", category: "groups", target: id });
      return { ok: true };
    } catch (err) {
      if (err instanceof ProtectedEntityError) return reply.code(403).send({ error: "protected_entity" });
      throw err;
    }
  });

  app.put("/api/groups/:id/roles", { preHandler: [app.authenticate, app.requirePermission("groups:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = rolesBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    await setGroupRoles(app.master, id, parsed.data.roleIds);
    await app.audit(req, { action: "group.set_roles", category: "groups", target: id, after: parsed.data });
    return { ok: true };
  });
}
