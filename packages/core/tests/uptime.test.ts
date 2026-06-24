/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Unit tests for the uptime accumulator (uptime.ts).
 */

import { describe, it, expect } from "vitest";
import { emptyBucket, accumulate, uptimePct } from "@/uptime.js";
import type { UptimeBucket } from "@/uptime.js";

// ---------------------------------------------------------------------------
// emptyBucket
// ---------------------------------------------------------------------------

describe("emptyBucket", () => {
  it("returns a zero-value bucket", () => {
    expect(emptyBucket()).toEqual<UptimeBucket>({ upSec: 0, totalSec: 0 });
  });

  it("returns a new object each call (no shared reference)", () => {
    const a = emptyBucket();
    const b = emptyBucket();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// accumulate
// ---------------------------------------------------------------------------

describe("accumulate", () => {
  it("adds to both upSec and totalSec when status is UP", () => {
    const result = accumulate(emptyBucket(), "UP", 60);
    expect(result).toEqual<UptimeBucket>({ upSec: 60, totalSec: 60 });
  });

  it("adds to totalSec only when status is DOWN", () => {
    const result = accumulate(emptyBucket(), "DOWN", 30);
    expect(result).toEqual<UptimeBucket>({ upSec: 0, totalSec: 30 });
  });

  it("adds to totalSec only when status is HANG", () => {
    const result = accumulate(emptyBucket(), "HANG", 15);
    expect(result).toEqual<UptimeBucket>({ upSec: 0, totalSec: 15 });
  });

  it("adds to totalSec only when status is DEGRADED", () => {
    const result = accumulate(emptyBucket(), "DEGRADED", 20);
    expect(result).toEqual<UptimeBucket>({ upSec: 0, totalSec: 20 });
  });

  it("adds to totalSec only when status is UNKNOWN", () => {
    const result = accumulate(emptyBucket(), "UNKNOWN", 10);
    expect(result).toEqual<UptimeBucket>({ upSec: 0, totalSec: 10 });
  });

  it("accumulates correctly across multiple calls (chained)", () => {
    let b = emptyBucket();
    b = accumulate(b, "UP", 3600);    // 1h UP
    b = accumulate(b, "DOWN", 1800);  // 30m DOWN
    b = accumulate(b, "UP", 900);     // 15m UP
    expect(b).toEqual<UptimeBucket>({ upSec: 4500, totalSec: 6300 });
  });

  it("is immutable — does not modify the input bucket", () => {
    const original = emptyBucket();
    const snapshot = { ...original };
    accumulate(original, "UP", 60);
    expect(original).toEqual(snapshot);
  });

  it("returns a new object (not the same reference)", () => {
    const b = emptyBucket();
    const result = accumulate(b, "UP", 10);
    expect(result).not.toBe(b);
  });

  it("clamps negative deltaSec to zero", () => {
    const result = accumulate(emptyBucket(), "UP", -100);
    expect(result).toEqual<UptimeBucket>({ upSec: 0, totalSec: 0 });
  });

  it("handles deltaSec of 0 without changing counters", () => {
    const b: UptimeBucket = { upSec: 50, totalSec: 100 };
    expect(accumulate(b, "UP", 0)).toEqual<UptimeBucket>({ upSec: 50, totalSec: 100 });
  });
});

// ---------------------------------------------------------------------------
// uptimePct
// ---------------------------------------------------------------------------

describe("uptimePct", () => {
  it("returns 0 when totalSec is 0 (no division-by-zero)", () => {
    expect(uptimePct(emptyBucket())).toBe(0);
  });

  it("returns 100 when upSec equals totalSec", () => {
    expect(uptimePct({ upSec: 3600, totalSec: 3600 })).toBe(100);
  });

  it("returns 0 when upSec is 0", () => {
    expect(uptimePct({ upSec: 0, totalSec: 3600 })).toBe(0);
  });

  it("returns 50 for half up / half down", () => {
    expect(uptimePct({ upSec: 1800, totalSec: 3600 })).toBe(50);
  });

  it("returns 99.72 for ~99.72% uptime", () => {
    // 3 minutes down in 24 hours: 24*3600 - 180 = 86220 up, 86400 total
    // 86220/86400 = 0.99791..., * 100 = 99.7916... → rounds to 99.79
    const up = 86220;
    const total = 86400;
    const expected = Math.round((up / total) * 100 * 100) / 100;
    expect(uptimePct({ upSec: up, totalSec: total })).toBe(expected);
  });

  it("rounds to 2 decimal places", () => {
    // 1/3 ≈ 33.333... → 33.33
    expect(uptimePct({ upSec: 1, totalSec: 3 })).toBe(33.33);
  });

  it("returns a number between 0 and 100 for any valid bucket", () => {
    const pct = uptimePct({ upSec: 7777, totalSec: 10000 });
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it("computes correctly after chained accumulates", () => {
    let b = emptyBucket();
    b = accumulate(b, "UP", 3 * 3600);   // 3h up
    b = accumulate(b, "DOWN", 1 * 3600); // 1h down
    // 3/4 = 75.00%
    expect(uptimePct(b)).toBe(75);
  });
});
