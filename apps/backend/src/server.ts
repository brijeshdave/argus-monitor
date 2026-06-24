/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Server entrypoint. Builds the application graph (see app.ts) and listens, with
 * graceful shutdown. All wiring lives in buildApp so tests exercise the same graph.
 */
import { buildApp } from "@/app.js";
import { startServerMonitorScheduler } from "@/services/server-monitor-scheduler.js";
import { startSnmpScheduler } from "@/services/snmp-scheduler.js";
import { startStorageScheduler } from "@/services/storage-scheduler.js";
import { startRetentionScheduler } from "@/services/retention-sweeper.js";
import { startFortinetLeases } from "@/services/fortinet.js";
import { AGENT_VERSION, ensureAllBuilds, goAvailable } from "@/services/agent-builds.js";

async function main() {
  const app = await buildApp();

  // Server-side probes (off the test path — these open sockets).
  startServerMonitorScheduler(app); // server-side ping + http/tcp/dns, per-monitor cadence
  startSnmpScheduler(app);
  startStorageScheduler(app);
  startRetentionScheduler(app);
  startFortinetLeases(app);

  // Ensure every platform's installer for the current agent version is built and
  // downloadable — in the background so startup isn't blocked. Runs only when a Go
  // toolchain is present; missing targets are compiled, existing ones left alone.
  void (async () => {
    if (!(await goAvailable())) return;
    try {
      const r = await ensureAllBuilds(AGENT_VERSION);
      if (r.built.length || r.failed.length) {
        app.log.info({ version: AGENT_VERSION, built: r.built, failed: r.failed }, "agent installers ensured");
      }
    } catch (err) {
      app.log.warn({ err }, "agent installer pre-build failed");
    }
  })();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ host: app.config.host, port: app.config.port });
  } catch (err) {
    app.log.error(err, "failed to start");
    process.exit(1);
  }
}

void main();
