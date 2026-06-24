/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Unit tests for ticker scheduling (ticker.ts).
 */

import { describe, it, expect } from "vitest";
import { activeTickers, isTickerActive } from "@/ticker.js";
import type { TickerWindow } from "@/ticker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-06-15T12:00:00.000Z");

const w = (over: Partial<TickerWindow> = {}): TickerWindow => ({
  enabled: true,
  startsAt: null,
  endsAt: null,
  priority: 0,
  ...over,
});

// ---------------------------------------------------------------------------
// isTickerActive
// ---------------------------------------------------------------------------

describe("isTickerActive", () => {
  it("is active when enabled with null bounds", () => {
    expect(isTickerActive(w(), NOW)).toBe(true);
  });

  it("is inactive when disabled (even within window)", () => {
    expect(isTickerActive(w({ enabled: false }), NOW)).toBe(false);
  });

  it("is inactive before startsAt", () => {
    expect(isTickerActive(w({ startsAt: "2026-06-15T13:00:00.000Z" }), NOW)).toBe(false);
  });

  it("is inactive after endsAt", () => {
    expect(isTickerActive(w({ endsAt: "2026-06-15T11:00:00.000Z" }), NOW)).toBe(false);
  });

  it("is active within an explicit window", () => {
    expect(
      isTickerActive(
        w({ startsAt: "2026-06-15T11:00:00.000Z", endsAt: "2026-06-15T13:00:00.000Z" }),
        NOW,
      ),
    ).toBe(true);
  });

  it("is active exactly at startsAt and endsAt (inclusive bounds)", () => {
    expect(isTickerActive(w({ startsAt: "2026-06-15T12:00:00.000Z" }), NOW)).toBe(true);
    expect(isTickerActive(w({ endsAt: "2026-06-15T12:00:00.000Z" }), NOW)).toBe(true);
  });

  it("is active with only an open-ended start in the past", () => {
    expect(isTickerActive(w({ startsAt: "2026-06-15T00:00:00.000Z" }), NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// activeTickers
// ---------------------------------------------------------------------------

describe("activeTickers", () => {
  it("returns only active messages", () => {
    const list = [
      w({ priority: 1 }), // active
      w({ enabled: false }), // disabled
      w({ startsAt: "2026-06-15T13:00:00.000Z" }), // not started
    ];
    expect(activeTickers(list, NOW)).toHaveLength(1);
  });

  it("sorts active messages by priority descending", () => {
    const list = [
      { ...w({ priority: 1 }), id: "low" },
      { ...w({ priority: 5 }), id: "high" },
      { ...w({ priority: 3 }), id: "mid" },
    ];
    expect(activeTickers(list, NOW).map((m) => m.id)).toEqual(["high", "mid", "low"]);
  });

  it("returns an empty list when nothing is active", () => {
    expect(activeTickers([w({ enabled: false })], NOW)).toEqual([]);
  });
});
