/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Retention selection (backupsToPrune): per-scope last-N + GFS daily/weekly/monthly.
 */
import { describe, expect, it } from "vitest";
import { backupsToPrune, type BackupMeta, type BackupRetention } from "@/backup.js";

/** Build a backup meta for a given scope at an ISO instant. */
const b = (scope: BackupMeta["scope"], iso: string): BackupMeta => ({
  name: `${scope}-${iso}`,
  size: 1,
  createdAt: new Date(iso).toISOString(),
  scope,
});

const NONE: BackupRetention = { keepAll: 0, keepConfig: 0, keepData: 0, daily: 0, weekly: 0, monthly: 0 };

describe("backupsToPrune", () => {
  it("keeps the newest N per scope (keep* rules), prunes the rest", () => {
    const rows = [
      b("config", "2026-06-23T02:00:00Z"),
      b("config", "2026-06-22T02:00:00Z"),
      b("config", "2026-06-21T02:00:00Z"),
      b("data", "2026-06-23T03:00:00Z"),
    ];
    const del = backupsToPrune(rows, { ...NONE, keepConfig: 2, keepData: 1 });
    expect(del).toEqual(["config-2026-06-21T02:00:00Z"]); // 3rd-newest config pruned; data kept
  });

  it("retention is per-scope independent", () => {
    const rows = [b("config", "2026-06-23T02:00:00Z"), b("data", "2026-06-23T03:00:00Z")];
    // keepConfig=1 protects config; keepData=0 + no GFS prunes data.
    expect(backupsToPrune(rows, { ...NONE, keepConfig: 1 })).toEqual(["data-2026-06-23T03:00:00Z"]);
  });

  it("daily GFS keeps the newest backup per day for N days", () => {
    const rows = [
      b("all", "2026-06-23T22:00:00Z"), // day 23 newest
      b("all", "2026-06-23T08:00:00Z"), // day 23 older → pruned
      b("all", "2026-06-22T08:00:00Z"), // day 22
      b("all", "2026-06-21T08:00:00Z"), // day 21 → beyond daily=2
    ];
    const del = backupsToPrune(rows, { ...NONE, daily: 2 });
    expect(del.sort()).toEqual(["all-2026-06-21T08:00:00Z", "all-2026-06-23T08:00:00Z"].sort());
  });

  it("a backup protected by ANY tier survives (daily+monthly union)", () => {
    const rows = [
      b("all", "2026-06-23T08:00:00Z"), // newest day + newest month
      b("all", "2026-05-15T08:00:00Z"), // previous month → kept by monthly, not daily
      b("all", "2026-04-15T08:00:00Z"), // older month → beyond monthly=2
    ];
    const del = backupsToPrune(rows, { ...NONE, daily: 1, monthly: 2 });
    expect(del).toEqual(["all-2026-04-15T08:00:00Z"]);
  });

  it("empty policy prunes everything", () => {
    const rows = [b("all", "2026-06-23T08:00:00Z"), b("config", "2026-06-23T08:00:00Z")];
    expect(backupsToPrune(rows, NONE).length).toBe(2);
  });
});
