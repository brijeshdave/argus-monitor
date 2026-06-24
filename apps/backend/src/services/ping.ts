/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Server-side host reachability + latency probe. Run by the BACKEND (not the
 * agent) so a host can be confirmed up — and its network latency tracked — even
 * when its agent is offline.
 *
 * Two probe modes:
 *   • ICMP echo via the system `ping` binary (default; no open port needed).
 *   • TCP connect to host:port (used when a port is configured; a refused
 *     connection still proves the host is reachable).
 *
 * SECURITY: the host is operator/agent-supplied, so it is validated against a
 * strict IP/hostname allowlist BEFORE it can reach execFile, which is always
 * called with an explicit args array (never a shell).
 */
import { execFile } from "node:child_process";
import { connect } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PingResult {
  up: boolean;
  /** Round-trip latency in milliseconds; null when down or not measured. */
  latencyMs: number | null;
}

/** Accept only plain IPv4/IPv6 literals or DNS hostnames — nothing shell-unsafe. */
const HOST_RE = /^[a-zA-Z0-9._:-]{1,253}$/;

export function isValidHost(host: string): boolean {
  return HOST_RE.test(host) && !host.startsWith("-");
}

/** TCP-connect probe: latency to first SYN-ACK/RST. Refused still means "up". */
function tcpPing(host: string, port: number, timeoutMs: number): Promise<PingResult> {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const done = (up: boolean) => {
      const latencyMs = up ? Number(process.hrtime.bigint() - started) / 1e6 : null;
      socket.destroy();
      resolve({ up, latencyMs });
    };
    const socket = connect({ host, port, timeout: timeoutMs });
    socket.once("connect", () => done(true));
    // A refused connection proves the host answered (it is reachable).
    socket.once("error", (err: NodeJS.ErrnoException) => done(err.code === "ECONNREFUSED"));
    socket.once("timeout", () => done(false));
  });
}

/** ICMP echo via the system `ping` (N packets). Up if any reply; reports min RTT. */
async function icmpPing(host: string, timeoutMs: number, count: number): Promise<PingResult> {
  const waitSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  // Linux iputils flags: -c count, -w deadline, -n numeric output.
  const { stdout } = await execFileAsync("ping", ["-n", "-c", String(count), "-w", String(waitSec), host], {
    timeout: timeoutMs + 1000,
  });
  // Fastest RTT across replies ("time=12.3 ms").
  const times = [...stdout.matchAll(/time[=<]\s*([\d.]+)\s*ms/gi)].map((m) => Number(m[1]));
  if (times.length === 0) return { up: false, latencyMs: null };
  return { up: true, latencyMs: Math.min(...times) };
}

export interface PingOptions {
  /** TCP port to probe; when set, uses a TCP connect probe instead of ICMP. */
  port?: number | null;
  timeoutMs?: number;
  /** ICMP packets to send (default 1); ignored in TCP mode. */
  count?: number;
}

/**
 * Probe a host once. Returns { up:false } for an invalid host, a failed ICMP, or
 * a TCP timeout — never throws, so one bad target can't wedge the scheduler.
 */
export async function pingHost(host: string, opts: PingOptions = {}): Promise<PingResult> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  if (!isValidHost(host)) return { up: false, latencyMs: null };
  if (opts.port != null) return tcpPing(host, opts.port, timeoutMs);
  try {
    return await icmpPing(host, timeoutMs, Math.max(1, opts.count ?? 1));
  } catch {
    // `ping` missing or host unreachable → down.
    return { up: false, latencyMs: null };
  }
}
