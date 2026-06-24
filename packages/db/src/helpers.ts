/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Shared Drizzle (pg-core) column helpers so every table follows the same
 * conventions: UUID text primary keys, timezone-aware timestamps, and a standard
 * created/updated pair. Columns are snake_case in SQL; Drizzle maps them to
 * camelCase TS keys at the call site.
 */
import { text, timestamp } from "drizzle-orm/pg-core";

/** UUID v4 text primary key, generated app-side for driver portability. */
export const pk = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

/** A foreign-key-style id column (no default); caller adds `.references(...)`. */
export const fk = (column: string) => text(column);

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();

/** Spread into a table to get standard created_at + updated_at columns. */
export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });
