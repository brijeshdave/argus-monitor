/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Wallboard device-registration routes. Two slices:
 *   • PUBLIC (no auth): a display self-registers and polls its pairing status.
 *   • MANAGEMENT (auth + RBAC + audit): operators approve/revoke/assign/delete.
 * On approval the device token is returned to the admin exactly once and never
 * logged/audited (only its hash is stored).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  assignGroup, assignLayout, claimDevice, createDevice, createGroup, deleteDevice, deleteGroup,
  getDeviceBundle, listDevices, listGroups, reconnectDevice, revokeDevice, touchDevice, updateGroup,
} from "@/services/devices.js";
import { getLayout } from "@/services/wallboards.js";

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // ── Public pairing slice (no auth) ─────────────────────────────────────────
  // The screen claims a 6-digit code the operator generated in the web UI; on success
  // the device token is returned once. A fingerprint reconnects as the same device.
  app.post("/api/devices/claim", async (req, reply) => {
    const parsed = z.object({
      code: z.string().min(1),
      fingerprint: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await claimDevice(app.master, parsed.data);
    if (!result) return reply.code(404).send({ error: "invalid_code" });
    return result;
  });

  // Silent reconnect for a previously-paired screen (by fingerprint) — no code needed.
  app.post("/api/devices/reconnect", async (req, reply) => {
    const parsed = z.object({ fingerprint: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await reconnectDevice(app.master, parsed.data.fingerprint);
    if (!result) return reply.code(404).send({ error: "reconnect_failed" });
    return result;
  });

  // ── Device render slice (device-token auth) ────────────────────────────────
  // A paired display fetches the board it should show (resolved from its group /
  // per-device assignment). Re-polled by the device so server-side changes apply.
  app.get("/api/wall/bundle", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!req.deviceId) return reply.code(403).send({ error: "device_only" });
    const bundle = await getDeviceBundle(app.master, req.deviceId);
    if (!bundle) return reply.code(404).send({ error: "not_found" });
    const layout = bundle.layoutId ? await getLayout(app.master, bundle.layoutId) : null;
    return { name: bundle.name, layout: layout ?? null };
  });

  // The display calls this only while the board is actually on screen + visible, so the
  // Devices list reflects whether a screen is really showing the wall (not just paired).
  app.post("/api/wall/heartbeat", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!req.deviceId) return reply.code(403).send({ error: "device_only" });
    await touchDevice(app.master, req.deviceId);
    return { ok: true };
  });

  // ── Management slice (auth + RBAC) ─────────────────────────────────────────
  app.get("/api/devices", { preHandler: [app.authenticate, app.requirePermission("devices:read")] }, async () => ({
    rows: await listDevices(app.master),
  }));

  app.post("/api/devices", { preHandler: [app.authenticate, app.requirePermission("devices:write")] }, async (req, reply) => {
    const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const device = await createDevice(app.master, parsed.data);
    if (!device) return reply.code(500).send({ error: "create_failed" });
    await app.audit(req, { action: "device.create", category: "devices", target: device.id, after: device });
    return reply.code(201).send({ device });
  });

  app.post("/api/devices/:id/revoke", { preHandler: [app.authenticate, app.requirePermission("devices:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const device = await revokeDevice(app.master, id);
    if (!device) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "device.revoke", category: "devices", target: id });
    return { device };
  });

  app.patch("/api/devices/:id/layout", { preHandler: [app.authenticate, app.requirePermission("devices:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ layoutId: z.string().min(1).nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const device = await assignLayout(app.master, id, parsed.data.layoutId);
    if (!device) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "device.assign_layout", category: "devices", target: id, after: { layoutId: parsed.data.layoutId } });
    return { device };
  });

  app.patch("/api/devices/:id/group", { preHandler: [app.authenticate, app.requirePermission("devices:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ groupId: z.string().min(1).nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const device = await assignGroup(app.master, id, parsed.data.groupId);
    if (!device) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "device.assign_group", category: "devices", target: id, after: { groupId: parsed.data.groupId } });
    return { device };
  });

  // ── Device groups (assign a board to a whole group) ────────────────────────
  app.get("/api/device-groups", { preHandler: [app.authenticate, app.requirePermission("devices:read")] }, async () => ({
    rows: await listGroups(app.master),
  }));

  app.post("/api/device-groups", { preHandler: [app.authenticate, app.requirePermission("devices:write")] }, async (req, reply) => {
    const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const group = await createGroup(app.master, parsed.data);
    if (!group) return reply.code(500).send({ error: "create_failed" });
    await app.audit(req, { action: "device_group.create", category: "devices", target: group.id, after: group });
    return reply.code(201).send({ group });
  });

  app.patch("/api/device-groups/:id", { preHandler: [app.authenticate, app.requirePermission("devices:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ name: z.string().min(1).optional(), layoutId: z.string().min(1).nullable().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const group = await updateGroup(app.master, id, parsed.data);
    if (!group) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "device_group.update", category: "devices", target: id, after: group });
    return { group };
  });

  app.delete("/api/device-groups/:id", { preHandler: [app.authenticate, app.requirePermission("devices:delete")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await deleteGroup(app.master, id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "device_group.delete", category: "devices", target: id });
    return { ok: true };
  });

  app.delete("/api/devices/:id", { preHandler: [app.authenticate, app.requirePermission("devices:delete")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await deleteDevice(app.master, id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "device.delete", category: "devices", target: id });
    return { ok: true };
  });
}
