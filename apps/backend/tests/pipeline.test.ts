/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Tests for the live ingest pipeline: unit samples → derived status events,
 * notifications on transitions, uptime accumulation, and baseline upsert.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createEphemeralTelemetryDb, notifications, statusEvents, unitStates, uptimeBuckets, type TelemetryDb,
} from "@argus/db";
import { processUnits } from "@/services/pipeline.js";

let db: TelemetryDb;
let close: () => Promise<void>;
const SRC = "agent-1";

beforeEach(async () => { ({ db, close } = await createEphemeralTelemetryDb()); });
afterEach(async () => { await close(); });

describe("processUnits", () => {
  it("emits a STATUS_CHANGE for a newly-seen unit and stores the baseline", async () => {
    await processUnits(db, SRC, [{ entity: "svcA", status: "UP", pid: 100 }]);
    const events = await db.select().from(statusEvents).where(eq(statusEvents.sourceId, SRC));
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("STATUS_CHANGE");
    expect(events[0]!.oldStatus).toBeNull();
    expect(events[0]!.newStatus).toBe("UP");

    const state = await db.select().from(unitStates).where(eq(unitStates.sourceId, SRC));
    expect(state[0]!.status).toBe("UP");
  });

  it("raises a critical notification on a transition to DOWN", async () => {
    await processUnits(db, SRC, [{ entity: "svcA", status: "UP", pid: 100 }]);
    await processUnits(db, SRC, [{ entity: "svcA", status: "DOWN", pid: 100 }]);

    const notes = await db.select().from(notifications).where(eq(notifications.sourceId, SRC));
    expect(notes.some((n) => n.severity === "critical" && (n.plainLanguage ?? "").length > 0)).toBe(true);
  });

  it("derives SERVICE_RESTART when the pid changes", async () => {
    await processUnits(db, SRC, [{ entity: "svcA", status: "UP", pid: 100 }]);
    await processUnits(db, SRC, [{ entity: "svcA", status: "UP", pid: 200 }]);
    const events = await db.select().from(statusEvents).where(eq(statusEvents.sourceId, SRC));
    expect(events.some((e) => e.type === "SERVICE_RESTART")).toBe(true);
  });

  it("accumulates uptime for the interval held in the prior status", async () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z");
    const t1 = new Date(t0.getTime() + 60_000); // +60s, still UP
    await processUnits(db, SRC, [{ entity: "svcA", status: "UP", pid: 100 }], t0);
    await processUnits(db, SRC, [{ entity: "svcA", status: "UP", pid: 100 }], t1);

    const buckets = await db.select().from(uptimeBuckets).where(eq(uptimeBuckets.sourceId, SRC));
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.totalSec).toBe(60);
    expect(buckets[0]!.upSec).toBe(60);
  });
});
