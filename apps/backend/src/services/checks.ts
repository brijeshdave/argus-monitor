/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Agentless synthetic checks run centrally from the Argus host (Uptime-Kuma style):
 * HTTP(S), TCP connect, and DNS resolution. Each returns a coarse {up, latencyMs,
 * detail} so the scheduler can feed the normal pipeline. Dependency-free (Node
 * stdlib + global fetch); never throws — a failed check is just `up: false`.
 */
import net from "node:net";
import { Resolver } from "node:dns/promises";

export interface CheckResult {
  up: boolean;
  latencyMs: number | null;
  detail: string;
}

const clampTimeout = (v: unknown, def: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 60_000) : def;
};

/** Does an HTTP status satisfy the configured expectation (default: 2xx/3xx)? */
function statusOk(status: number, expected: unknown): boolean {
  if (typeof expected === "string" && expected.trim()) {
    // Comma list of codes or "xxx-yyy" ranges, e.g. "200,301,500-599".
    return expected.split(",").some((part) => {
      const p = part.trim();
      const m = p.match(/^(\d{3})\s*-\s*(\d{3})$/);
      if (m) return status >= Number(m[1]) && status <= Number(m[2]);
      return Number(p) === status;
    });
  }
  return status >= 200 && status < 400;
}

/** HTTP(S) check: fetch a URL, assert the status (+ optional body keyword). */
export async function httpCheck(config: Record<string, unknown>): Promise<CheckResult> {
  const url = typeof config.url === "string" ? config.url : "";
  if (!url) return { up: false, latencyMs: null, detail: "no url configured" };
  const method = (typeof config.method === "string" && config.method.toUpperCase()) || "GET";
  const keyword = typeof config.keyword === "string" ? config.keyword : "";
  const timeoutMs = clampTimeout(config.timeoutMs, 10_000);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { method, redirect: "follow", signal: ctrl.signal, headers: { "user-agent": "Argus-Monitor/1" } });
    const latencyMs = Date.now() - started;
    if (!statusOk(res.status, config.expectedStatus)) {
      return { up: false, latencyMs, detail: `HTTP ${res.status}` };
    }
    if (keyword) {
      const body = await res.text();
      if (!body.includes(keyword)) return { up: false, latencyMs, detail: `keyword "${keyword}" not found` };
    }
    return { up: true, latencyMs, detail: `HTTP ${res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? (err.name === "AbortError" ? `timeout after ${timeoutMs}ms` : err.message) : "request failed";
    return { up: false, latencyMs: null, detail: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** TCP check: can we open a connection to host:port within the timeout? */
export async function tcpCheck(config: Record<string, unknown>): Promise<CheckResult> {
  const host = typeof config.host === "string" ? config.host : "";
  const port = typeof config.port === "number" ? config.port : Number(config.port);
  if (!host || !Number.isInteger(port) || port <= 0) return { up: false, latencyMs: null, detail: "host/port not configured" };
  const timeoutMs = clampTimeout(config.timeoutMs, 8_000);

  return new Promise<CheckResult>((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const done = (r: CheckResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done({ up: true, latencyMs: Date.now() - started, detail: `connected ${host}:${port}` }));
    socket.once("timeout", () => done({ up: false, latencyMs: null, detail: `timeout after ${timeoutMs}ms` }));
    socket.once("error", (e) => done({ up: false, latencyMs: null, detail: e.message }));
    socket.connect(port, host);
  });
}

/** DNS check: does `host` resolve the given record type (optionally via `resolver`)? */
export async function dnsCheck(config: Record<string, unknown>): Promise<CheckResult> {
  const host = typeof config.host === "string" ? config.host : "";
  if (!host) return { up: false, latencyMs: null, detail: "no hostname configured" };
  const recordType = (typeof config.recordType === "string" && config.recordType.toUpperCase()) || "A";
  const timeoutMs = clampTimeout(config.timeoutMs, 8_000);

  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  if (typeof config.resolver === "string" && config.resolver.trim()) resolver.setServers([config.resolver.trim()]);

  const started = Date.now();
  try {
    const records = await resolver.resolve(host, recordType as "A");
    const latencyMs = Date.now() - started;
    const count = Array.isArray(records) ? records.length : 0;
    if (count === 0) return { up: false, latencyMs, detail: `no ${recordType} records` };
    return { up: true, latencyMs, detail: `${count} ${recordType} record${count === 1 ? "" : "s"}` };
  } catch (err) {
    return { up: false, latencyMs: null, detail: err instanceof Error ? err.message : "resolve failed" };
  }
}
