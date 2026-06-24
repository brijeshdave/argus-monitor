/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Agent build routes (operator-facing, RBAC-guarded, audited). Building spawns the
 * Go cross-compiler, so it is gated by `agents:write` and only ever runs with an
 * allowlisted OS/arch. Listing/downloading require `agents:read`; downloads address
 * a specific version+platform folder (the service confines every path to BUILD_DIR).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AGENT_VERSION,
  ALLOWED_ARCH,
  ALLOWED_OS,
  NAS_FORMATS,
  buildAgent,
  buildNasImage,
  readNasImage,
  ensureAllBuilds,
  goAvailable,
  listBuilds,
  readBuildFile,
} from "@/services/agent-builds.js";

export async function agentBuildRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/agent-builds", { preHandler: [app.authenticate, app.requirePermission("agents:read")] }, async () => ({
    rows: await listBuilds(),
    goAvailable: await goAvailable(),
    currentVersion: AGENT_VERSION,
  }));

  app.post("/api/agent-builds", { preHandler: [app.authenticate, app.requirePermission("agents:write")] }, async (req, reply) => {
    const parsed = z
      .object({
        os: z.enum(ALLOWED_OS).optional(),
        arch: z.enum(ALLOWED_ARCH).default("amd64"),
        all: z.boolean().optional(), // build the whole platform matrix for this version
        nas: z.boolean().optional(), // build just the NAS/container image for `arch`
        format: z.enum(NAS_FORMATS).optional(), // NAS image format (default qnap)
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    if (!(await goAvailable())) {
      return reply.code(503).send({
        error: "go_toolchain_unavailable",
        message: "The server has no Go toolchain; build agents on a host with Go or use a builder image.",
      });
    }

    try {
      if (parsed.data.nas) {
        const format = parsed.data.format ?? "qnap";
        const img = await buildNasImage(parsed.data.arch, AGENT_VERSION, format);
        await app.audit(req, { action: "agentbuild.nas", category: "agents", target: `nas-${format}-${parsed.data.arch}@${AGENT_VERSION}` });
        return { version: AGENT_VERSION, os: "nas", arch: parsed.data.arch, format, size: img.size, builtAt: new Date().toISOString() };
      }
      if (parsed.data.all || !parsed.data.os) {
        const result = await ensureAllBuilds(AGENT_VERSION);
        await app.audit(req, { action: "agentbuild.create", category: "agents", target: `all@${AGENT_VERSION}`, after: result });
        return { version: AGENT_VERSION, ...result };
      }
      const meta = await buildAgent(parsed.data.os, parsed.data.arch, AGENT_VERSION);
      await app.audit(req, { action: "agentbuild.create", category: "agents", target: `${meta.os}-${meta.arch}@${meta.version}`, after: meta });
      return meta;
    } catch (err) {
      app.log.error({ err, target: parsed.data }, "agent build failed");
      return reply.code(500).send({ error: "build_failed", message: (err as Error).message });
    }
  });

  app.get("/api/agent-builds/download", { preHandler: [app.authenticate, app.requirePermission("agents:read")] }, async (req, reply) => {
    const parsed = z
      .object({ version: z.string().min(1), os: z.enum(ALLOWED_OS), arch: z.enum(ALLOWED_ARCH) })
      .safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    let file: { buf: Buffer; filename: string };
    try {
      file = await readBuildFile(parsed.data.version, parsed.data.os, parsed.data.arch);
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.buf);
  });

  // NAS / Container image — a `docker load`-able archive (Container Station Import),
  // built daemon-free on demand. Requires the Go toolchain (to ensure the linux
  // binary) + tar in the image.
  app.get("/api/agent-builds/nas-image", { preHandler: [app.authenticate, app.requirePermission("agents:read")] }, async (req, reply) => {
    const parsed = z.object({ arch: z.enum(ALLOWED_ARCH).default("amd64"), format: z.enum(NAS_FORMATS).default("qnap") }).safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    if (!(await goAvailable())) {
      return reply.code(503).send({ error: "go_toolchain_unavailable", message: "The server has no Go toolchain to build the agent binary." });
    }
    let file: { buf: Buffer; filename: string };
    try {
      file = await readNasImage(parsed.data.arch, AGENT_VERSION, parsed.data.format);
    } catch (err) {
      app.log.error({ err }, "nas image build failed");
      return reply.code(500).send({ error: "build_failed", message: (err as Error).message });
    }
    await app.audit(req, { action: "agentbuild.nas", category: "agents", target: `nas-${parsed.data.format}-${parsed.data.arch}@${AGENT_VERSION}` });
    return reply
      .header("Content-Type", "application/x-tar")
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.buf);
  });
}
