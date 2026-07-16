/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Ticker message routes (operator-facing, RBAC-guarded, audited). The "active"
 * endpoint resolves which messages are live right now via the pure core scheduler.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TICKER_SEVERITIES } from "@argus/shared";
import { TICKER_SPEED_MAX, TICKER_SPEED_MIN } from "@argus/shared";
import {
  createTicker, deleteTicker, deviceGroupIdFor, getTickerSpeed, listActiveTicker, listTicker,
  setTickerSpeed, updateTicker, userGroupIdsFor, type TickerViewer,
} from "@/services/ticker.js";

const isoDate = z.string().datetime();
const severity = z.enum(TICKER_SEVERITIES);
const groupIds = z.array(z.string()).optional();

const createSchema = z.object({
  text: z.string().min(1),
  enabled: z.boolean().optional(),
  severity: severity.optional(),
  priority: z.number().int().optional(),
  startsAt: isoDate.nullable().optional(),
  endsAt: isoDate.nullable().optional(),
  deviceGroupIds: groupIds,
  userGroupIds: groupIds,
});

const updateSchema = z.object({
  text: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  severity: severity.optional(),
  priority: z.number().int().optional(),
  startsAt: isoDate.nullable().optional(),
  endsAt: isoDate.nullable().optional(),
  deviceGroupIds: groupIds,
  userGroupIds: groupIds,
});

export async function tickerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/ticker", { preHandler: [app.authenticate, app.requirePermission("ticker:read")] }, async () => ({
    rows: await listTicker(app.master),
  }));

  app.get("/api/ticker/active", { preHandler: [app.authenticate, app.requirePermission("ticker:read", { allowDevice: true })] }, async (req) => {
    // Audience targeting: a wall device sees its device-group's messages; a user sees
    // their user-groups' messages; owners + automation see everything.
    const subjectId = req.subject!.userId;
    let viewer: TickerViewer;
    if (subjectId.startsWith("device:")) {
      viewer = { kind: "device", groupId: await deviceGroupIdFor(app.master, subjectId.slice("device:".length)) };
    } else if (req.subject!.isOwner) {
      viewer = { kind: "all" };
    } else {
      viewer = { kind: "user", groupIds: await userGroupIdsFor(app.master, subjectId) };
    }
    const [rows, speed] = await Promise.all([listActiveTicker(app.master, Date.now(), viewer), getTickerSpeed(app.master)]);
    return { rows, speed };
  });

  // Ticker display config (scroll speed). Kept under ticker:* perms so authors can
  // tune it without needing the global settings permission.
  app.get("/api/ticker/config", { preHandler: [app.authenticate, app.requirePermission("ticker:read")] }, async () => ({
    speed: await getTickerSpeed(app.master),
  }));

  app.put("/api/ticker/config", { preHandler: [app.authenticate, app.requirePermission("ticker:write")] }, async (req, reply) => {
    const parsed = z.object({ speed: z.number().int().min(TICKER_SPEED_MIN).max(TICKER_SPEED_MAX) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const speed = await setTickerSpeed(app.master, parsed.data.speed);
    await app.audit(req, { action: "ticker.config", category: "ticker", target: "speed", after: { speed } });
    return { speed };
  });

  app.post("/api/ticker", { preHandler: [app.authenticate, app.requirePermission("ticker:write")] }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const message = await createTicker(app.master, parsed.data);
    if (!message) return reply.code(500).send({ error: "create_failed" });
    await app.audit(req, { action: "ticker.create", category: "ticker", target: message.id, after: message });
    return reply.code(201).send({ message });
  });

  app.patch("/api/ticker/:id", { preHandler: [app.authenticate, app.requirePermission("ticker:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const message = await updateTicker(app.master, id, parsed.data);
    if (!message) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "ticker.update", category: "ticker", target: id, after: message });
    return { message };
  });

  app.delete("/api/ticker/:id", { preHandler: [app.authenticate, app.requirePermission("ticker:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await deleteTicker(app.master, id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    await app.audit(req, { action: "ticker.delete", category: "ticker", target: id });
    return { ok: true };
  });
}
