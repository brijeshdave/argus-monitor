/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Session contract. A SessionDTO is the safe, public projection of a refresh-token
 * row used by the self-service "active sessions" UI and the admin session manager.
 * It NEVER includes the token hash (or any credential material) — only metadata.
 */
import type { IsoTimestamp } from "./common.js";

/** A single active session, derived from a (non-revoked, unexpired) refresh token. */
export interface SessionDTO {
  id: string;
  userId: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: IsoTimestamp;
  lastUsedAt: IsoTimestamp | null;
  /** True when this row is the caller's current session (resolved by token hash). */
  current: boolean;
}
