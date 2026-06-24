/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Operator LIVE channel (`WS /ws`). Authenticated operators (and wallboards)
 * connect with a JWT in `?token=`, receive a one-shot `snapshot`, then live
 * `patch` messages broadcast by the ingest path. Server → client only; the
 * socket is never trusted for mutations. @fastify/websocket is registered once
 * in app.ts — this plugin only adds a route.
 */
import fp from "fastify-plugin";
import { getLiveSnapshot } from "@/services/live.js";
import { OperatorHub } from "@/services/operator-hub.js";
import { resolveSubject } from "@/services/subject.js";
import { resolveDeviceToken } from "@/services/devices.js";

declare module "fastify" {
  interface FastifyInstance {
    operatorHub: OperatorHub;
  }
}

export default fp(async (app) => {
  app.decorate("operatorHub", new OperatorHub());

  app.get("/ws", { websocket: true }, (socket, req) => {
    void (async () => {
      const token = (req.query as { token?: string }).token;
      if (!token) return socket.close();

      // Display-device token (read-only live feed) or an operator JWT.
      if (token.startsWith("wd_")) {
        const device = await resolveDeviceToken(app.master, token);
        if (!device) return socket.close();
      } else {
        let sub: string;
        try {
          const payload = app.jwt.verify<{ sub: string }>(token);
          sub = payload.sub;
        } catch {
          return socket.close();
        }
        const subject = await resolveSubject(app.master, sub);
        if (!subject) return socket.close();
        if (!subject.isOwner && !subject.permissions.includes("dashboard:read")) {
          return socket.close();
        }
      }

      app.operatorHub.add(socket);
      socket.on("close", () => app.operatorHub.remove(socket));

      try {
        const snapshot = await getLiveSnapshot(app.master, app.telemetry, (id) => app.agentHub.isOnline(id));
        if (socket.readyState === 1 /* OPEN */) socket.send(JSON.stringify(snapshot));
      } catch (err) {
        app.log.error({ err }, "failed to send live snapshot");
      }
    })();
  });
});
