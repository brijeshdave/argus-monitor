/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Role management routes. Every mutating route is permission-guarded (RBAC) and
 * audited. System roles (superadmin, admin, operator, viewer) are rejected by the
 * service layer via assertMutable.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ProtectedEntityError } from "@argus/core";
import {
  createRole, deleteRole, getRole, getRolePermissionKeys, listRoles, setRolePermissions, updateRole,
} from "@/services/roles.js";

const createBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  permissionKeys: z.array(z.string()).optional(),
});

const updateBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

const permissionsBody = z.object({ permissionKeys: z.array(z.string()) });

export async function roleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/roles", { preHandler: [app.authenticate, app.requirePermission("roles:read")] }, async () => {
    return { rows: await listRoles(app.master) };
  });

  app.post("/api/roles", { preHandler: [app.authenticate, app.requirePermission("roles:write")] }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const role = await createRole(app.master, parsed.data);
    await app.audit(req, { action: "role.create", category: "roles", target: role?.id ?? null, after: role });
    return reply.code(201).send({ role });
  });

  app.patch("/api/roles/:id", { preHandler: [app.authenticate, app.requirePermission("roles:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    try {
      const before = await getRole(app.master, id);
      const role = await updateRole(app.master, id, parsed.data);
      if (!role) return reply.code(404).send({ error: "not_found" });
      await app.audit(req, { action: "role.update", category: "roles", target: id, before, after: role });
      return { role };
    } catch (err) {
      if (err instanceof ProtectedEntityError) return reply.code(403).send({ error: "protected_entity" });
      throw err;
    }
  });

  app.delete("/api/roles/:id", { preHandler: [app.authenticate, app.requirePermission("roles:delete")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const before = await getRole(app.master, id);
      const ok = await deleteRole(app.master, id);
      if (!ok) return reply.code(404).send({ error: "not_found" });
      await app.audit(req, { action: "role.delete", category: "roles", target: id, before });
      return { ok: true };
    } catch (err) {
      if (err instanceof ProtectedEntityError) return reply.code(403).send({ error: "protected_entity" });
      throw err;
    }
  });

  app.put("/api/roles/:id/permissions", { preHandler: [app.authenticate, app.requirePermission("roles:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = permissionsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    // Capture the prior grant so the audit log records a before/after diff of the
    // permission set (access reviews care about *what changed*, not just the result).
    const before = await getRolePermissionKeys(app.master, id);
    await setRolePermissions(app.master, id, parsed.data.permissionKeys);
    const after = [...parsed.data.permissionKeys].sort();
    const added = after.filter((k) => !before.includes(k));
    const removed = before.filter((k) => !after.includes(k));
    // Field name avoids "key" so the audit redactor (which scrubs *key* fields)
    // doesn't blank the permission lists — these are capability names, not secrets.
    await app.audit(req, {
      action: "role.set_permissions",
      category: "roles",
      target: id,
      before: { permissions: before },
      after: { permissions: after, added, removed },
    });
    return { ok: true };
  });
}
