/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * WSS agent control channel (`/ws/agent`). The agent opens a single outbound,
 * connection-key-authenticated socket. Server handles register/heartbeat/ack and
 * pushes commands (restart/update/config). No inbound ports on monitored hosts.
 */
import fp from "fastify-plugin";
import type { AgentToServer } from "@argus/shared";
import { resolveAgentKey, touchKeyUsage } from "@/services/agent-keys.js";
import { getAgent, registerAgent, touchAgent } from "@/services/agents.js";
import { flushPending, markAcked } from "@/services/agent-commands.js";
import { ensureDefaultPingMonitor } from "@/services/monitors.js";
import { AgentHub } from "@/services/agent-hub.js";
import { setAgentScanState } from "@/services/scan-manager.js";

declare module "fastify" {
  interface FastifyInstance {
    agentHub: AgentHub;
  }
}

export default fp(async (app) => {
  // @fastify/websocket is registered once in app.ts (it may only register once);
  // this plugin only adds the agent control-channel route.
  app.decorate("agentHub", new AgentHub());

  app.get("/ws/agent", { websocket: true }, (socket, req) => {
    // Key from header (preferred) or query (?key=) for restricted clients.
    const headerKey = req.headers["x-argus-key"];
    const queryKey = (req.query as { key?: string }).key;
    const rawKey = (Array.isArray(headerKey) ? headerKey[0] : headerKey) ?? queryKey;

    let agentId: string | null = null;

    const close = () => socket.close();

    // Push an online/offline change to operators so dashboards/wallboards flip
    // without waiting for the next ingest or a manual refresh.
    const broadcastConnectivity = async (id: string): Promise<void> => {
      const agent = await getAgent(app.master, id, (x) => app.agentHub.isOnline(x));
      if (!agent) return;
      app.operatorHub.broadcast({
        t: "agent",
        agents: [{ id: agent.id, name: agent.name, status: agent.status, online: agent.online, lastSeenAt: agent.lastSeenAt }],
        ts: new Date().toISOString(),
      });
    };

    socket.on("message", (data: Buffer) => {
      void (async () => {
        if (!rawKey) return close();
        const keyRow = await resolveAgentKey(app.master, rawKey);
        if (!keyRow) return close();

        let msg: AgentToServer;
        try {
          msg = JSON.parse(data.toString()) as AgentToServer;
        } catch {
          return;
        }

        if (msg.t === "register") {
          const res = await registerAgent(app.master, keyRow, msg);
          agentId = res.agentId;
          app.agentHub.add(agentId, socket);
          await touchKeyUsage(app.master, keyRow.id);
          socket.send(JSON.stringify({ t: "registered", agentId: res.agentId, status: res.status }));
          await flushPending(app.master, app.agentHub, agentId);
          if (res.status === "approved") await ensureDefaultPingMonitor(app.master, agentId, msg.address ?? null);
          await broadcastConnectivity(agentId);
        } else if (msg.t === "heartbeat") {
          if (agentId) await touchAgent(app.master, agentId);
          socket.send(JSON.stringify({ t: "pong" }));
        } else if (msg.t === "ack") {
          await markAcked(app.master, msg.commandId);
        } else if (msg.t === "scan") {
          setAgentScanState(app, msg.monitorId, msg); // live "Scan now" progress + lifecycle logging
        }
      })();
    });

    socket.on("close", () => {
      if (!agentId) return;
      const id = agentId;
      app.agentHub.remove(id);
      void broadcastConnectivity(id);
    });
  });
});
