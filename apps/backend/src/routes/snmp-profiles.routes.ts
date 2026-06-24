/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * SNMP profile routes (the "MIB master"). Read with `monitors:read`; create/edit/
 * delete with `monitors:write`. System (built-in) profiles are protected by the
 * service (edit/delete → 403). Profiles are imported/exported as JSON via these.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SNMP_DEVICE_TYPES } from "@argus/shared";
import {
  createSnmpProfile, deleteSnmpProfile, getSnmpProfile, listSnmpProfiles, updateSnmpProfile,
} from "@/services/snmp-profiles.js";
import { snmpWalk } from "@/services/snmp.js";
import { deleteMib, importMib, listMibs, resolveOidNames } from "@/services/mib.js";

const oidSchema = z.object({
  label: z.string().min(1),
  oid: z.string().regex(/^\.?\d+(\.\d+)*$/, "must be a numeric OID"),
  unit: z.string().optional(),
  group: z.string().optional(),
});

const tableSchema = z.object({
  name: z.string().min(1),
  oid: z.string().regex(/^\.?\d+(\.\d+)*$/),
  columns: z.array(z.object({ label: z.string().min(1), col: z.number().int().positive(), unit: z.string().optional(), enum: z.record(z.string(), z.string()).optional() })).max(40),
});

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  vendor: z.string().max(80).optional(),
  deviceType: z.enum(SNMP_DEVICE_TYPES).optional(),
  model: z.string().max(120).optional(),
  standard: z.boolean().optional(),
  oids: z.array(oidSchema).max(200).optional(),
  tables: z.array(tableSchema).max(20).optional(),
});

export async function snmpProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/snmp-profiles", { preHandler: [app.authenticate, app.requirePermission("monitors:read")] }, async () => ({
    rows: await listSnmpProfiles(app.master),
  }));

  // Browse a live device's MIB subtree to discover OIDs for a profile (no guessing).
  app.post("/api/snmp/walk", { preHandler: [app.authenticate, app.requirePermission("monitors:write")] }, async (req, reply) => {
    const parsed = z.object({
      host: z.string().min(1).max(253),
      community: z.string().max(120).optional(),
      version: z.enum(["1", "2c"]).optional(),
      oid: z.string().regex(/^\.?\d+(\.\d+)*$/).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    // Default base: MIB-2 system+host-resources+interfaces (broad but bounded).
    const result = await snmpWalk(parsed.data.host, {
      community: parsed.data.community,
      version: parsed.data.version,
      oid: parsed.data.oid || "1.3.6.1.2.1",
      max: 1500,
    });
    // Enrich with names from imported MIBs (overrides the built-in fallback names).
    if (result.rows.length) {
      const names = await resolveOidNames(app.master, result.rows.map((r) => r.oid));
      for (const r of result.rows) r.name = names.get(r.oid) || r.name;
    }
    return result;
  });

  // ── MIB files (the OID-name master) ──────────────────────────────────────────
  app.get("/api/snmp/mibs", { preHandler: [app.authenticate, app.requirePermission("monitors:read")] }, async () => ({
    rows: await listMibs(app.master),
  }));

  app.post("/api/snmp/mibs", { preHandler: [app.authenticate, app.requirePermission("monitors:write")] }, async (req, reply) => {
    const parsed = z.object({ name: z.string().min(1).max(160), content: z.string().min(1).max(4_000_000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await importMib(app.master, parsed.data.name.trim(), parsed.data.content);
    await app.audit(req, { action: "mib.import", category: "monitors", target: parsed.data.name.trim(), after: result });
    return result;
  });

  app.delete("/api/snmp/mibs/:name", { preHandler: [app.authenticate, app.requirePermission("monitors:write")] }, async (req, reply) => {
    const { name } = req.params as { name: string };
    await deleteMib(app.master, decodeURIComponent(name));
    await app.audit(req, { action: "mib.delete", category: "monitors", target: name });
    return reply.send({ ok: true });
  });

  app.post("/api/snmp-profiles", { preHandler: [app.authenticate, app.requirePermission("monitors:write")] }, async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const profile = await createSnmpProfile(app.master, parsed.data);
    await app.audit(req, { action: "snmpprofile.create", category: "monitors", target: profile.id, after: profile });
    return { profile };
  });

  app.patch("/api/snmp-profiles/:id", { preHandler: [app.authenticate, app.requirePermission("monitors:write")] }, async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    try {
      const profile = await updateSnmpProfile(app.master, (req.params as { id: string }).id, parsed.data);
      if (!profile) return reply.code(404).send({ error: "not_found" });
      await app.audit(req, { action: "snmpprofile.update", category: "monitors", target: profile.id, after: profile });
      return { profile };
    } catch {
      return reply.code(403).send({ error: "protected", message: "System profile is read-only — clone it to customize." });
    }
  });

  app.delete("/api/snmp-profiles/:id", { preHandler: [app.authenticate, app.requirePermission("monitors:write")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await getSnmpProfile(app.master, id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    try {
      await deleteSnmpProfile(app.master, id);
      await app.audit(req, { action: "snmpprofile.delete", category: "monitors", target: id, before: existing });
      return { ok: true };
    } catch {
      return reply.code(403).send({ error: "protected", message: "System profile cannot be deleted." });
    }
  });
}
