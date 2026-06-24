/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Unit tests for the storage capacity forecaster (storage.ts).
 */
import { describe, it, expect } from "vitest";
import { forecastStorage } from "@/storage.js";
import type { StoragePoint } from "@argus/shared";

const GB = 1024 ** 3;
const day = (n: number): string => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();

/** Build a history of `n` daily samples that grow by `perDayGB` from `startGB`. */
function series(n: number, startGB: number, perDayGB: number, totalGB: number): StoragePoint[] {
  return Array.from({ length: n }, (_, i) => {
    const usedGB = startGB + perDayGB * i;
    return { ts: day(i), usedBytes: usedGB * GB, totalBytes: totalGB * GB, usedPct: (usedGB / totalGB) * 100 };
  });
}

describe("forecastStorage", () => {
  it("returns null without at least two used-bytes samples", () => {
    expect(forecastStorage([])).toBeNull();
    expect(forecastStorage(series(1, 10, 1, 100))).toBeNull();
  });

  it("estimates a linear growth rate (bytes/day)", () => {
    const f = forecastStorage(series(10, 50, 2, 100)); // +2 GB/day
    expect(f).not.toBeNull();
    expect(f!.growthBytesPerDay / GB).toBeCloseTo(2, 5);
    expect(f!.samples).toBe(10);
    expect(f!.spanDays).toBeCloseTo(9, 5);
  });

  it("projects days-to-full from the latest sample at the current rate", () => {
    // 10 days: used goes 50→68 GB (+2/day); last=68, total=100 → 32 GB remaining / 2 = 16 days.
    const f = forecastStorage(series(10, 50, 2, 100));
    expect(f!.daysToFull).toBeCloseTo(16, 4);
    expect(f!.projectedFullDate).not.toBeNull();
  });

  it("reports no days-to-full when the share is flat or shrinking", () => {
    expect(forecastStorage(series(5, 40, 0, 100))!.daysToFull).toBeNull();
    const shrinking = forecastStorage(series(5, 80, -3, 100))!;
    expect(shrinking.growthBytesPerDay).toBeLessThan(0);
    expect(shrinking.daysToFull).toBeNull();
  });

  it("ignores samples missing used bytes and tolerates unordered input", () => {
    const pts = series(4, 10, 5, 100).reverse();
    pts.push({ ts: day(9), usedBytes: null, totalBytes: 100 * GB, usedPct: null });
    const f = forecastStorage(pts);
    expect(f!.growthBytesPerDay / GB).toBeCloseTo(5, 5);
    expect(f!.samples).toBe(4);
  });
});
