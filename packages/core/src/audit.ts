/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Pure audit-entry builder with deep secret redaction — secrets must never land in the audit log.
 */

/**
 * Object keys whose VALUES must be redacted wherever they appear (case-insensitive, substring).
 * Covers common naming conventions: password, passwd, secret, token, key, cipher, credential,
 * authorization.  Anything matching this pattern is replaced with REDACTED in audit rows.
 */
export const SECRET_KEY_PATTERN =
  /pass(word)?|secret|token|key|cipher|credential|authorization/i;

export const REDACTED = "[REDACTED]";

export interface AuditEntryInput {
  actor?: string | null; // user id or "system" / "agent"
  actorRole?: string | null;
  action: string; // e.g. "user.create"
  category: string; // resource category, e.g. "users"
  target?: string | null; // affected entity id
  before?: unknown; // prior state (will be redacted)
  after?: unknown; // new state (will be redacted)
  ip?: string | null;
}

export interface AuditEntry {
  actor: string | null;
  actorRole: string | null;
  action: string;
  category: string;
  target: string | null;
  before: unknown; // redacted copy (or null)
  after: unknown; // redacted copy (or null)
  ip: string | null;
}

/**
 * Returns a deep-cloned copy of `value` with any object property whose KEY matches
 * SECRET_KEY_PATTERN replaced by the string REDACTED — but only when the original
 * value is not null/undefined (those stay as-is so callers can distinguish "was
 * absent" from "was a secret string").
 *
 * Rules:
 *  - Primitives (string, number, boolean, null, undefined) pass through unchanged.
 *  - Arrays are cloned element-by-element; each element is recursed into.
 *  - Plain objects are cloned key-by-key; secret keys with non-null/undefined
 *    values are replaced with REDACTED; all other values are recursed into.
 *  - The original input is NEVER mutated.
 */
export function redact(value: unknown): unknown {
  // Primitives and null pass through as-is — nothing to clone or redact.
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    // Clone array and recurse into each element.
    return value.map((element: unknown) => redact(element));
  }

  if (typeof value === "object") {
    // Plain object: clone key-by-key, redacting secret keys.
    const source = value as Record<string, unknown>;
    const clone: Record<string, unknown> = {};

    for (const key of Object.keys(source)) {
      const val = source[key];

      if (SECRET_KEY_PATTERN.test(key) && val !== null && val !== undefined) {
        // The key name suggests a secret and the value is present — redact it.
        clone[key] = REDACTED;
      } else {
        // Recurse so nested secrets inside plain objects / arrays are also caught.
        clone[key] = redact(val);
      }
    }

    return clone;
  }

  // string | number | boolean — return as-is.
  return value;
}

/**
 * Builds a normalised, redacted AuditEntry ready to be persisted.
 *
 * - Optional fields that are absent or explicitly undefined are normalised to null.
 * - `before` and `after` are deep-cloned through `redact` so secrets never land
 *   in the audit row even if the caller passes full domain objects.
 */
export function buildAuditEntry(input: AuditEntryInput): AuditEntry {
  return {
    actor: input.actor ?? null,
    actorRole: input.actorRole ?? null,
    action: input.action,
    category: input.category,
    target: input.target ?? null,
    // Treat absent before/after as null; redact anything provided.
    before: input.before !== undefined ? redact(input.before) : null,
    after: input.after !== undefined ? redact(input.after) : null,
    ip: input.ip ?? null,
  };
}
