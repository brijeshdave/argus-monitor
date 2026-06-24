/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Per-monitor scheduler for everything the Argus host probes itself: server-side
 * ping + the agentless synthetic checks (http/tcp/dns). Unlike a fixed global
 * sweep, each monitor runs on ITS OWN interval, with configurable retries and a
 * retry interval (and ICMP packet count for ping). A failed probe is retried up to
 * `retries` times spaced by `retryInterval` before it's recorded DOWN — so a single
 * blip doesn't flap the status. Results flow through the same pipeline agents use
 * (events / uptime / notifications / unit-state) plus a latency sample + live patch.
 *
 * Single-node, in-process (ADR-0005). A 1s base tick fires monitors whose next-due
 * time has passed; a probe (incl. its retries) never overlaps itself. Started from
 * server.ts so app-graph tests never open sockets.
 */
import type { FastifyInstance } from "fastify";
import { pingSamples } from "@argus/db";
import { monitorSchedule, type MonitorDTO } from "@argus/shared";
import { listAgents } from "@/services/agents.js";
import { listEnabledChecks, listEnabledPingMonitors } from "@/services/monitors.js";
import { processUnits } from "@/services/pipeline.js";
import { pingHost } from "@/services/ping.js";
import { httpCheck, tcpCheck, dnsCheck } from "@/services/checks.js";

interface ProbeResult { up: boolean; latencyMs: number | null }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reload the worklist from the DB this often (ms). */
const REFRESH_MS = 15_000;
/** Base tick — the finest scheduling granularity (ms). */
const TICK_MS = 1_000;

/** The probe for one monitor (ping uses ICMP/TCP; http/tcp/dns the check engine). */
function probeFor(m: MonitorDTO, fallbackHost: string | null, count: number): () => Promise<ProbeResult> {
  const cfg = m.config as Record<string, unknown>;
  if (m.type === "ping") {
    const host = (typeof cfg.host === "string" && cfg.host) || fallbackHost;
    const port = typeof cfg.port === "number" ? cfg.port : null;
    return async () => (host ? pingHost(host, { port, count }) : { up: false, latencyMs: null });
  }
  if (m.type === "http") return () => httpCheck(cfg);
  if (m.type === "tcp") return () => tcpCheck(cfg);
  if (m.type === "dns") return () => dnsCheck(cfg);
  return async () => ({ up: false, latencyMs: null });
}

export function startServerMonitorScheduler(app: FastifyInstance): () => void {
  // Per-monitor run state (next-due timestamp + an in-flight guard).
  const state = new Map<string, { nextDue: number; inflight: boolean }>();
  let worklist: MonitorDTO[] = [];
  let addressByAgent = new Map<string, string | null>();
  let lastRefresh = 0;

  async function refresh(): Promise<void> {
    const [pings, checks, agents] = await Promise.all([
      listEnabledPingMonitors(app.master),
      listEnabledChecks(app.master),
      listAgents(app.master),
    ]);
    // Server-side ping only (agent-side ping is handled by the agent itself).
    worklist = [...pings.filter((m) => (m.config as { server?: unknown }).server === true), ...checks];
    addressByAgent = new Map(agents.map((a) => [a.id, a.address]));
    const live = new Set(worklist.map((m) => m.id));
    for (const id of state.keys()) if (!live.has(id)) state.delete(id);
  }

  /** Run + record one monitor: probe (with retries), pipeline, latency, live patch. */
  async function run(m: MonitorDTO): Promise<void> {
    const sched = monitorSchedule(m.type, m.config);
    const probe = probeFor(m, addressByAgent.get(m.agentId) ?? null, sched.count);
    let result = await probe();
    for (let i = 0; !result.up && i < sched.retries; i++) {
      await sleep(sched.retryIntervalSec * 1000);
      result = await probe();
    }
    const status = result.up ? "UP" : "DOWN";
    await processUnits(app.telemetry, m.agentId, [{ entity: m.name, status }]);
    await app.telemetry.insert(pingSamples).values({ monitorId: m.id, sourceId: m.agentId, up: result.up, latencyMs: result.latencyMs });
    app.operatorHub.broadcast({
      t: "patch",
      agentId: m.agentId,
      units: [{ sourceId: m.agentId, entity: m.name, status, pid: null, latencyMs: result.latencyMs }],
      ts: new Date().toISOString(),
    });
  }

  async function tick(): Promise<void> {
    const now = Date.now();
    if (now - lastRefresh >= REFRESH_MS) {
      lastRefresh = now;
      await refresh().catch((err) => app.log.error({ err }, "monitor scheduler refresh failed"));
    }
    for (const m of worklist) {
      const s = state.get(m.id) ?? { nextDue: now, inflight: false };
      state.set(m.id, s);
      if (s.inflight || now < s.nextDue) continue;
      s.inflight = true;
      void run(m)
        .catch((err) => app.log.error({ err, monitor: m.id }, "monitor probe failed"))
        .finally(() => {
          s.inflight = false;
          s.nextDue = Date.now() + monitorSchedule(m.type, m.config).intervalSec * 1000;
        });
    }
  }

  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  void tick(); // prime immediately so status is fresh on boot

  const stop = () => clearInterval(timer);
  app.addHook("onClose", async () => stop());
  return stop;
}
