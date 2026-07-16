/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Wallboard layout routes (operator-facing, RBAC-guarded, audited). System/default
 * layouts are protected: mutating them raises ProtectedEntityError → HTTP 403.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ProtectedEntityError } from "@argus/core";
import { WALL_PANEL_METRICS, WALL_TEMPLATES } from "@argus/shared";
import {
  cloneLayout, createLayout, deleteLayout, getLayout, listLayouts, setDefaultLayout, setPanelConfig, setRotateSec, setTemplate, updateLayout,
} from "@/services/wallboards.js";

const layoutSchema = z.record(z.string(), z.unknown());

export async function wallboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/wallboards", { preHandler: [app.authenticate, app.requirePermission("wallboards:read", { allowDevice: true })] }, async () => ({
    rows: await listLayouts(app.master),
  }));

  app.get("/api/wallboards/:id", { preHandler: [app.authenticate, app.requirePermission("wallboards:read", { allowDevice: true })] }, async (req, reply) => {
    const layout = await getLayout(app.master, (req.params as { id: string }).id);
    return layout ? { layout } : reply.code(404).send({ error: "not_found" });
  });

  app.post("/api/wallboards", { preHandler: [app.authenticate, app.requirePermission("wallboards:write")] }, async (req, reply) => {
    const parsed = z
      .object({ name: z.string().min(1), description: z.string().optional(), layout: layoutSchema.optional() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const layout = await createLayout(app.master, parsed.data);
    if (!layout) return reply.code(500).send({ error: "create_failed" });
    await app.audit(req, { action: "wallboard.create", category: "wallboards", target: layout.id, after: layout });
    return reply.code(201).send({ layout });
  });

  app.patch("/api/wallboards/:id", { preHandler: [app.authenticate, app.requirePermission("wallboards:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ name: z.string().min(1).optional(), description: z.string().optional(), layout: layoutSchema.optional() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const layout = await updateLayout(app.master, id, parsed.data);
      if (!layout) return reply.code(404).send({ error: "not_found" });
      await app.audit(req, { action: "wallboard.update", category: "wallboards", target: id, after: layout });
      return { layout };
    } catch (err) {
      if (err instanceof ProtectedEntityError) return reply.code(403).send({ error: err.code });
      throw err;
    }
  });

  app.delete("/api/wallboards/:id", { preHandler: [app.authenticate, app.requirePermission("wallboards:delete")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const ok = await deleteLayout(app.master, id);
      if (!ok) return reply.code(404).send({ error: "not_found" });
      await app.audit(req, { action: "wallboard.delete", category: "wallboards", target: id });
      return { ok: true };
    } catch (err) {
      if (err instanceof ProtectedEntityError) return reply.code(403).send({ error: err.code });
      throw err;
    }
  });

  app.post("/api/wallboards/:id/rotate", { preHandler: [app.authenticate, app.requirePermission("wallboards:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ rotateSec: z.number().int().min(0).max(3600) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const layout = await setRotateSec(app.master, id, parsed.data.rotateSec);
    if (!layout) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "wallboard.rotate", category: "wallboards", target: id, after: { rotateSec: layout.rotateSec } });
    return { layout };
  });

  app.post("/api/wallboards/:id/template", { preHandler: [app.authenticate, app.requirePermission("wallboards:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ template: z.enum(WALL_TEMPLATES) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const layout = await setTemplate(app.master, id, parsed.data.template);
    if (!layout) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "wallboard.template", category: "wallboards", target: id, after: { template: layout.template } });
    return { layout };
  });

  app.post("/api/wallboards/:id/panel", { preHandler: [app.authenticate, app.requirePermission("wallboards:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({
      mode: z.enum(["panels", "tiles"]).optional(),
      hosts: z.array(z.string()).nullable().optional(),
      metrics: z.record(z.string(), z.array(z.enum(WALL_PANEL_METRICS))).optional(),
      monitors: z.record(z.string(), z.array(z.string())).optional(),
      snmp: z.record(z.string(), z.object({
        volumes: z.array(z.string()).optional(),
        items: z.array(z.string()).optional(),
        disks: z.boolean().optional(),
      })).optional(),
      title: z.string().max(120).optional(),
      icon: z.string().max(40).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const layout = await setPanelConfig(app.master, id, parsed.data);
    if (!layout) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "wallboard.panel", category: "wallboards", target: id, after: { panelConfig: layout.panelConfig } });
    return { layout };
  });

  app.post("/api/wallboards/:id/default", { preHandler: [app.authenticate, app.requirePermission("wallboards:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const layout = await setDefaultLayout(app.master, id);
    if (!layout) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "wallboard.setDefault", category: "wallboards", target: id });
    return { layout };
  });

  app.post("/api/wallboards/:id/clone", { preHandler: [app.authenticate, app.requirePermission("wallboards:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const layout = await cloneLayout(app.master, id, parsed.data);
    if (!layout) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "wallboard.clone", category: "wallboards", target: layout.id, after: { from: id } });
    return reply.code(201).send({ layout });
  });
}
