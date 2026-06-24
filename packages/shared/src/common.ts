/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Primitive, cross-cutting contracts shared by every layer. Kept tiny and stable
 * — richer domain shapes live in their own modules and are added per phase.
 */
import { z } from "zod";

/** ISO-8601 UTC timestamp, e.g. "2026-06-14T08:30:00.000Z". */
export type IsoTimestamp = string;

/** Coarse health status used across services, databases, storage and hosts. */
export const HEALTH_STATUSES = ["UP", "DEGRADED", "HANG", "DOWN", "UNKNOWN"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/** A standard, paginated envelope for list endpoints. */
export interface Page<T> {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
}

/** zod helpers reused by route/payload validation throughout the backend. */
export const zIso = z.string().datetime();
export const zId = z.string().min(1);
export const zHealthStatus = z.enum(HEALTH_STATUSES);
