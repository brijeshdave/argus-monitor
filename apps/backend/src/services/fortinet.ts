/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * FortiGate DHCP-lease provider. Many networks run DHCP on a FortiGate (not Windows),
 * so the agent's DNS/NetBIOS/Windows-DHCP chain can't name cross-subnet clients. This
 * polls the FortiGate REST API (/api/v2/monitor/system/dhcp), which returns every
 * lease's IP + MAC + hostname across all scopes, and exposes an in-memory IP→lease map
 * used to enrich connected-client samples at ingest. Opt-in via env:
 *   FORTIGATE_URL      e.g. https://10.2.0.1
 *   FORTIGATE_TOKEN    a FortiOS REST API admin token
 *   FORTIGATE_INSECURE "false" to enforce TLS verification (default: skip — self-signed)
 *   FORTIGATE_INTERVAL_MS  poll cadence (default 300000)
 */
import https from "node:https";
import { URL } from "node:url";
import type { FastifyInstance } from "fastify";

export interface DhcpLease { hostname?: string; mac?: string }

let leases = new Map<string, DhcpLease>();

/** Look up a DHCP lease (hostname/MAC) for an IP, or undefined. */
export function getDhcpLease(ip: string): DhcpLease | undefined {
  return leases.get(ip);
}

interface FortiLease { ip?: string; mac?: string; hostname?: string }

function fetchLeases(base: string, token: string, insecure: boolean): Promise<FortiLease[]> {
  return new Promise((resolve, reject) => {
    const u = new URL(`${base.replace(/\/$/, "")}/api/v2/monitor/system/dhcp`);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        rejectUnauthorized: !insecure,
        timeout: 8000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(body) as { results?: FortiLease[] };
            resolve(json.results ?? []);
          } catch (e) {
            reject(e as Error);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

/** Start polling FortiGate DHCP leases (no-op unless FORTIGATE_URL + TOKEN are set). */
export function startFortinetLeases(app: FastifyInstance): () => void {
  const base = process.env.FORTIGATE_URL;
  const token = process.env.FORTIGATE_TOKEN;
  if (!base || !token) return () => {};
  const insecure = process.env.FORTIGATE_INSECURE !== "false"; // default: skip cert (self-signed)
  const intervalMs = Number(process.env.FORTIGATE_INTERVAL_MS ?? 300_000);

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const rows = await fetchLeases(base, token, insecure);
      const next = new Map<string, DhcpLease>();
      for (const r of rows) {
        if (!r.ip) continue;
        next.set(r.ip, { hostname: r.hostname || undefined, mac: r.mac ? r.mac.toLowerCase() : undefined });
      }
      leases = next;
      app.log.info({ leases: leases.size }, "fortinet dhcp leases refreshed");
    } catch (err) {
      app.log.warn({ err }, "fortinet dhcp lease fetch failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();
  const stop = () => clearInterval(timer);
  app.addHook("onClose", async () => stop());
  return stop;
}
