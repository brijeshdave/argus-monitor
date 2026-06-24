/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Developer documentation route — served only to subjects holding `developer:read`
 * (superadmin + admin by default, or any group granted it). The content is loaded
 * from Markdown files on the server, so it is not shipped in the public bundle.
 */
import type { FastifyInstance } from "fastify";
import { loadDeveloperDocs } from "@/content/developer-docs.js";

export async function developerDocsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/developer-docs",
    { preHandler: [app.authenticate, app.requirePermission("developer:read")] },
    async () => ({ set: loadDeveloperDocs() }),
  );
}
