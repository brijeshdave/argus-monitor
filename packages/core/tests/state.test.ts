/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Unit tests for the overall health rollup (state.ts).
 */

import { describe, it, expect } from "vitest";
import { rollup } from "@/state.js";
import type { Unit } from "@/state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const u = (status: Unit["status"], critical: boolean): Unit => ({
  status,
  critical,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("rollup", () => {
  it("returns UNKNOWN for an empty unit list", () => {
    expect(rollup([])).toBe("UNKNOWN");
  });

  it("returns UP when all units are UP", () => {
    expect(rollup([u("UP", true), u("UP", false)])).toBe("UP");
  });

  it("returns UP with a single UP unit", () => {
    expect(rollup([u("UP", false)])).toBe("UP");
  });

  // --- critical unit bad ---

  it("returns DOWN when a critical unit is DOWN", () => {
    expect(rollup([u("DOWN", true), u("UP", false)])).toBe("DOWN");
  });

  it("returns DOWN when a critical unit is HANG", () => {
    expect(rollup([u("HANG", true), u("UP", false)])).toBe("DOWN");
  });

  it("critical DOWN beats non-critical DOWN (returns DOWN, not DEGRADED)", () => {
    expect(rollup([u("DOWN", false), u("HANG", true)])).toBe("DOWN");
  });

  it("returns DOWN when only unit is critical and DOWN", () => {
    expect(rollup([u("DOWN", true)])).toBe("DOWN");
  });

  it("returns DOWN when only unit is critical and HANG", () => {
    expect(rollup([u("HANG", true)])).toBe("DOWN");
  });

  // --- non-critical unit bad ---

  it("returns DEGRADED when a non-critical unit is DOWN and no critical bad", () => {
    expect(rollup([u("DOWN", false), u("UP", true)])).toBe("DEGRADED");
  });

  it("returns DEGRADED when a non-critical unit is HANG and no critical bad", () => {
    expect(rollup([u("HANG", false), u("UP", true)])).toBe("DEGRADED");
  });

  it("returns DEGRADED when only unit is non-critical and DOWN", () => {
    expect(rollup([u("DOWN", false)])).toBe("DEGRADED");
  });

  it("returns DEGRADED when only unit is non-critical and HANG", () => {
    expect(rollup([u("HANG", false)])).toBe("DEGRADED");
  });

  // --- mixed UP / UNKNOWN ---

  it("returns UNKNOWN when units are UP and UNKNOWN (no bad units)", () => {
    expect(rollup([u("UP", false), u("UNKNOWN", false)])).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for a single UNKNOWN unit", () => {
    expect(rollup([u("UNKNOWN", true)])).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for a mix of UNKNOWN units", () => {
    expect(rollup([u("UNKNOWN", false), u("UNKNOWN", true)])).toBe("UNKNOWN");
  });

  // --- DEGRADED status on a unit (not a bad status, so no escalation) ---

  it("returns UNKNOWN when a unit is already DEGRADED but no DOWN/HANG units", () => {
    // DEGRADED is not "bad" (not DOWN or HANG), so it falls through to UNKNOWN
    // because not all units are UP.
    expect(rollup([u("DEGRADED", false), u("UP", false)])).toBe("UNKNOWN");
  });

  // --- multiple units mixed ---

  it("critical DOWN wins over a non-critical UP", () => {
    expect(
      rollup([u("UP", false), u("DOWN", true), u("UP", true)]),
    ).toBe("DOWN");
  });

  it("all critical UP returns UP", () => {
    expect(rollup([u("UP", true), u("UP", true)])).toBe("UP");
  });
});
