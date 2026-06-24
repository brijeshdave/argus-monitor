/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Unit tests for event-derivation helpers (diff.ts).
 */

import { describe, it, expect } from "vitest";
import { diffStates, diffClients, isStale } from "@/diff.js";
import type { UnitSample, DerivedEvent } from "@/diff.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMap(samples: UnitSample[]): Map<string, UnitSample> {
  return new Map(samples.map((s) => [s.entity, s]));
}

// ---------------------------------------------------------------------------
// diffStates
// ---------------------------------------------------------------------------

describe("diffStates", () => {
  it("emits nothing when nothing changed", () => {
    const prev = makeMap([{ entity: "nginx", status: "UP" }]);
    const curr: UnitSample[] = [{ entity: "nginx", status: "UP" }];
    expect(diffStates(prev, curr)).toEqual([]);
  });

  it("emits STATUS_CHANGE with oldStatus null for a brand-new entity", () => {
    const prev = makeMap([]);
    const curr: UnitSample[] = [{ entity: "nginx", status: "UP" }];
    const events = diffStates(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual<DerivedEvent>({
      type: "STATUS_CHANGE",
      entity: "nginx",
      oldStatus: null,
      newStatus: "UP",
    });
  });

  it("emits STATUS_CHANGE when status changes", () => {
    const prev = makeMap([{ entity: "nginx", status: "UP" }]);
    const curr: UnitSample[] = [{ entity: "nginx", status: "DOWN" }];
    const events = diffStates(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual<DerivedEvent>({
      type: "STATUS_CHANGE",
      entity: "nginx",
      oldStatus: "UP",
      newStatus: "DOWN",
    });
  });

  it("does NOT emit STATUS_CHANGE when status is identical", () => {
    const prev = makeMap([{ entity: "db", status: "HANG" }]);
    const curr: UnitSample[] = [{ entity: "db", status: "HANG" }];
    expect(diffStates(prev, curr)).toEqual([]);
  });

  // --- SERVICE_RESTART ---

  it("emits SERVICE_RESTART when both pids are positive and differ", () => {
    const prev = makeMap([{ entity: "nginx", status: "UP", pid: 100 }]);
    const curr: UnitSample[] = [{ entity: "nginx", status: "UP", pid: 200 }];
    const events = diffStates(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual<DerivedEvent>({
      type: "SERVICE_RESTART",
      entity: "nginx",
      oldPid: 100,
      newPid: 200,
    });
  });

  it("does NOT emit SERVICE_RESTART when pids are the same", () => {
    const prev = makeMap([{ entity: "nginx", status: "UP", pid: 100 }]);
    const curr: UnitSample[] = [{ entity: "nginx", status: "UP", pid: 100 }];
    expect(diffStates(prev, curr)).toEqual([]);
  });

  it("does NOT emit SERVICE_RESTART when old pid is absent", () => {
    const prev = makeMap([{ entity: "nginx", status: "UP" }]);
    const curr: UnitSample[] = [{ entity: "nginx", status: "UP", pid: 200 }];
    expect(diffStates(prev, curr)).toEqual([
      // Only a STATUS_CHANGE is NOT expected since status didn't change; also no restart.
    ]);
    // Confirm no restart event
    const events = diffStates(prev, curr);
    expect(events.some((e) => e.type === "SERVICE_RESTART")).toBe(false);
  });

  it("does NOT emit SERVICE_RESTART when new pid is absent", () => {
    const prev = makeMap([{ entity: "nginx", status: "UP", pid: 100 }]);
    const curr: UnitSample[] = [{ entity: "nginx", status: "UP" }];
    expect(diffStates(prev, curr).some((e) => e.type === "SERVICE_RESTART")).toBe(false);
  });

  it("does NOT emit SERVICE_RESTART when old pid is 0", () => {
    const prev = makeMap([{ entity: "nginx", status: "UP", pid: 0 }]);
    const curr: UnitSample[] = [{ entity: "nginx", status: "UP", pid: 200 }];
    expect(diffStates(prev, curr).some((e) => e.type === "SERVICE_RESTART")).toBe(false);
  });

  it("does NOT emit SERVICE_RESTART when new pid is 0", () => {
    const prev = makeMap([{ entity: "nginx", status: "UP", pid: 100 }]);
    const curr: UnitSample[] = [{ entity: "nginx", status: "UP", pid: 0 }];
    expect(diffStates(prev, curr).some((e) => e.type === "SERVICE_RESTART")).toBe(false);
  });

  it("does NOT emit SERVICE_RESTART when old pid is null", () => {
    const prev = makeMap([{ entity: "nginx", status: "UP", pid: null }]);
    const curr: UnitSample[] = [{ entity: "nginx", status: "UP", pid: 200 }];
    expect(diffStates(prev, curr).some((e) => e.type === "SERVICE_RESTART")).toBe(false);
  });

  // --- Ordering: STATUS_CHANGE before SERVICE_RESTART for same entity ---

  it("emits STATUS_CHANGE before SERVICE_RESTART for the same entity", () => {
    const prev = makeMap([{ entity: "svc", status: "UP", pid: 10 }]);
    const curr: UnitSample[] = [{ entity: "svc", status: "DOWN", pid: 20 }];
    const events = diffStates(prev, curr);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("STATUS_CHANGE");
    expect(events[1]!.type).toBe("SERVICE_RESTART");
  });

  // --- Stable ordering: follow current array order ---

  it("emits events in the same order as the current samples array", () => {
    const prev = makeMap([]);
    const curr: UnitSample[] = [
      { entity: "z", status: "UP" },
      { entity: "a", status: "DOWN" },
    ];
    const events = diffStates(prev, curr);
    expect(events[0]).toMatchObject({ entity: "z" });
    expect(events[1]).toMatchObject({ entity: "a" });
  });

  // --- Multiple entities ---

  it("handles multiple entities: some new, some changed, some unchanged", () => {
    const prev = makeMap([
      { entity: "nginx", status: "UP" },
      { entity: "postgres", status: "UP" },
    ]);
    const curr: UnitSample[] = [
      { entity: "nginx", status: "DOWN" },  // changed
      { entity: "postgres", status: "UP" }, // unchanged
      { entity: "redis", status: "UP" },    // new
    ];
    const events = diffStates(prev, curr);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "STATUS_CHANGE", entity: "nginx", oldStatus: "UP", newStatus: "DOWN" });
    expect(events[1]).toMatchObject({ type: "STATUS_CHANGE", entity: "redis", oldStatus: null, newStatus: "UP" });
  });

  // --- entity present in prev but absent from current produces no events ---

  it("emits no event for entities present only in prev (removal is handled upstream)", () => {
    const prev = makeMap([{ entity: "old-svc", status: "UP" }]);
    const curr: UnitSample[] = [];
    expect(diffStates(prev, curr)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// diffClients
// ---------------------------------------------------------------------------

describe("diffClients", () => {
  it("emits nothing when sets are identical", () => {
    const prev = new Set(["alice", "bob"]);
    const curr = new Set(["alice", "bob"]);
    expect(diffClients(prev, curr)).toEqual([]);
  });

  it("emits CLIENT_CONNECT for a new client", () => {
    const prev = new Set<string>();
    const curr = new Set(["alice"]);
    const events = diffClients(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "CLIENT_CONNECT", client: "alice" });
  });

  it("emits CLIENT_DISCONNECT for a departed client", () => {
    const prev = new Set(["alice"]);
    const curr = new Set<string>();
    const events = diffClients(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "CLIENT_DISCONNECT", client: "alice" });
  });

  it("emits both CONNECT and DISCONNECT when sets differ", () => {
    const prev = new Set(["alice", "bob"]);
    const curr = new Set(["bob", "carol"]);
    const events = diffClients(prev, curr);
    expect(events).toContainEqual({ type: "CLIENT_CONNECT", client: "carol" });
    expect(events).toContainEqual({ type: "CLIENT_DISCONNECT", client: "alice" });
    expect(events).toHaveLength(2);
  });

  it("emits nothing when both sets are empty", () => {
    expect(diffClients(new Set(), new Set())).toEqual([]);
  });

  it("emits CONNECT for each new client", () => {
    const prev = new Set<string>();
    const curr = new Set(["x", "y", "z"]);
    const events = diffClients(prev, curr);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.type === "CLIENT_CONNECT")).toBe(true);
  });

  it("emits DISCONNECT for each departed client", () => {
    const prev = new Set(["x", "y", "z"]);
    const curr = new Set<string>();
    const events = diffClients(prev, curr);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.type === "CLIENT_DISCONNECT")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isStale
// ---------------------------------------------------------------------------

describe("isStale", () => {
  // Fix "now" to a known epoch so tests are deterministic.
  const NOW_ISO = "2026-06-15T12:00:00.000Z";
  const NOW_MS = Date.parse(NOW_ISO); // epoch ms

  it("returns false when the sample is fresh (within threshold)", () => {
    // 30 seconds ago, threshold 60 seconds
    const lastSeen = new Date(NOW_MS - 30_000).toISOString();
    expect(isStale(lastSeen, NOW_MS, 60)).toBe(false);
  });

  it("returns false when the sample is exactly at the threshold boundary", () => {
    // Exactly 60 000 ms ago — NOT strictly greater, so still fresh.
    const lastSeen = new Date(NOW_MS - 60_000).toISOString();
    expect(isStale(lastSeen, NOW_MS, 60)).toBe(false);
  });

  it("returns true when the sample is older than the threshold", () => {
    // 61 seconds ago, threshold 60 seconds
    const lastSeen = new Date(NOW_MS - 61_000).toISOString();
    expect(isStale(lastSeen, NOW_MS, 61 - 1)).toBe(true);
  });

  it("returns true when the sample is well past the threshold", () => {
    const lastSeen = new Date(NOW_MS - 5 * 60_000).toISOString();
    expect(isStale(lastSeen, NOW_MS, 60)).toBe(true);
  });

  it("returns true for an unparseable timestamp (safety default)", () => {
    expect(isStale("not-a-date", NOW_MS, 60)).toBe(true);
  });

  it("returns true when now equals the parse result + threshold + 1ms", () => {
    const lastSeen = new Date(NOW_MS - 120_001).toISOString();
    expect(isStale(lastSeen, NOW_MS, 120)).toBe(true);
  });
});
