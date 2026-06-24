/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Ping probe tests. The host string is operator/agent-supplied and flows into
 * execFile, so the validation guard is security-sensitive — these lock down what
 * may pass. A TCP probe against a refused local port also confirms "reachable but
 * closed" still reads as up (the host answered).
 */
import { describe, expect, it } from "vitest";
import { isValidHost, pingHost } from "@/services/ping.js";

describe("isValidHost", () => {
  it("accepts plain IPs and hostnames", () => {
    for (const h of ["10.0.0.1", "192.168.1.50", "host.example.com", "fe80::1", "agent-01"]) {
      expect(isValidHost(h)).toBe(true);
    }
  });

  it("rejects shell-unsafe / flag-like inputs", () => {
    for (const h of ["", "-c1000", "1.2.3.4; rm -rf /", "$(id)", "a b", "host`whoami`", "x".repeat(300)]) {
      expect(isValidHost(h)).toBe(false);
    }
  });
});

describe("pingHost (TCP mode)", () => {
  it("reports an invalid host as down without probing", async () => {
    expect(await pingHost("bad host", { port: 80 })).toEqual({ up: false, latencyMs: null });
  });

  it("treats a refused local TCP port as reachable (host answered)", async () => {
    // Port 1 is almost certainly closed locally → ECONNREFUSED → up.
    const res = await pingHost("127.0.0.1", { port: 1, timeoutMs: 1000 });
    expect(res.up).toBe(true);
    expect(res.latencyMs).not.toBeNull();
  });
});
