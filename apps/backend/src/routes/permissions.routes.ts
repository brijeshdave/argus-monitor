/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Permissions catalogue routes. The catalogue is read-only at runtime — permissions
 * are defined in @argus/shared and seeded. Guarded with roles:read because this
 * endpoint exists primarily to power the roles editor in the admin UI.
 */
import type { FastifyInstance } from "fastify";
import { listPermissions } from "@/services/permissions.js";

export async function permissionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/permissions", { preHandler: [app.authenticate, app.requirePermission("roles:read")] }, async () => {
    return { rows: await listPermissions(app.master) };
  });
}
