/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Pure RBAC + ABAC authorization evaluator — no I/O, no framework imports.
 */

// ---------------------------------------------------------------------------
// Access model (ADR-0004 summary)
// ---------------------------------------------------------------------------
// Users gain permissions exclusively via the chain:
//   user → groups → roles → permissions
// The backend resolves that chain and produces a flat `AuthSubject` with the
// union of every "resource:action" key the user holds.  Nothing in this file
// touches the DB; it only evaluates the pre-resolved set.
//
// ABAC attributes sit on top of RBAC: even when a subject holds a permission,
// a resource may demand that the subject carries matching contextual attributes
// (e.g. the site or region the resource belongs to).  Every required key must
// be satisfied — it is a logical AND across keys.
//
// The protected owner (bootstrapped superadmin) bypasses both checks entirely
// so that the system can always be administered even if role config is broken.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Resolved security context for a single request.  The backend builds this
 * from the JWT + RBAC DB query before passing it to any `authorize` call.
 */
export interface AuthSubject {
  userId: string;
  /** Protected owner → unconditional bypass of all permission/attribute checks. */
  isOwner: boolean;
  /** Flat union of "resource:action" keys derived from group→role→permission chain. */
  permissions: readonly string[];
  /** ABAC attributes attached to the subject (e.g. site, region, tenant). */
  attributes: readonly { key: string; value: string }[];
}

/**
 * Contextual information about the resource being accessed.
 * All fields are optional — pass `{}` or omit entirely for permission-only checks.
 */
export interface ResourceContext {
  /**
   * ABAC constraints the subject MUST satisfy.
   * - `string`  → subject must have an attribute with that key whose value equals the string.
   * - `string[]` → subject must have an attribute with that key whose value is one of the array elements.
   * All entries are ANDed together; an empty/undefined record passes trivially.
   */
  requiredAttributes?: Record<string, string | string[]>;
  /** User ID of the natural owner of the resource (informational; not used in this evaluator). */
  ownerUserId?: string;
}

/** Explains why a decision was reached — useful for audit logging. */
export type AuthzReason =
  | "owner_bypass"        // subject is the protected owner; all checks skipped
  | "granted"             // permission held and all attributes satisfied
  | "missing_permission"  // subject does not hold the required permission
  | "attribute_mismatch"; // permission held but ABAC attributes not satisfied

/** Decision record returned by `authorize`. */
export interface AuthzResult {
  allowed: boolean;
  reason: AuthzReason;
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when `action` appears in the subject's flat permission set.
 * Comparison is case-sensitive (permissions are normalised to lowercase by the
 * backend when they are seeded from the RBAC catalogue).
 */
export function hasPermission(subject: AuthSubject, action: string): boolean {
  return subject.permissions.includes(action);
}

/**
 * Returns true when the subject satisfies every key in `required`.
 *
 * For each required key the subject must have AT LEAST ONE attribute entry
 * whose value matches the constraint:
 *   - string  → exact equality
 *   - string[] → value is included in the array
 *
 * An absent or empty `required` object is always satisfied (open world).
 */
export function satisfiesAttributes(
  subject: AuthSubject,
  required?: Record<string, string | string[]>,
): boolean {
  if (required === undefined) return true;

  const keys = Object.keys(required);
  if (keys.length === 0) return true;

  for (const key of keys) {
    const constraint = required[key];
    // `noUncheckedIndexedAccess` means `constraint` could be `undefined` here
    // even though we iterated `Object.keys` — guard defensively.
    if (constraint === undefined) continue;

    // Find at least one subject attribute that satisfies this key's constraint.
    const satisfied = subject.attributes.some((attr) => {
      if (attr.key !== key) return false;
      if (Array.isArray(constraint)) {
        return (constraint as string[]).includes(attr.value);
      }
      return attr.value === constraint;
    });

    if (!satisfied) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Primary evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluates whether `subject` may perform `action` on `resource`.
 *
 * Decision order (short-circuit on first match):
 *  1. Owner bypass  — `isOwner` → always allowed, no further checks.
 *  2. Permission    — subject must hold `action` in its permission set.
 *  3. ABAC          — if `resource.requiredAttributes` is present, all keys
 *                     must be satisfied by the subject's attributes.
 *  4. Granted       — all checks passed.
 */
export function authorize(
  subject: AuthSubject,
  action: string,
  resource?: ResourceContext,
): AuthzResult {
  // 1. Protected owner bypasses everything — critical for bootstrapped recovery.
  if (subject.isOwner) {
    return { allowed: true, reason: "owner_bypass" };
  }

  // 2. RBAC: the subject must hold the requested permission.
  if (!hasPermission(subject, action)) {
    return { allowed: false, reason: "missing_permission" };
  }

  // 3. ABAC: every required attribute constraint must be met.
  if (
    resource?.requiredAttributes !== undefined &&
    !satisfiesAttributes(subject, resource.requiredAttributes)
  ) {
    return { allowed: false, reason: "attribute_mismatch" };
  }

  // 4. All checks passed.
  return { allowed: true, reason: "granted" };
}

// ---------------------------------------------------------------------------
// Convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Boolean convenience wrapper over `authorize`.
 * Use `authorize` directly when you need the reason for audit logging.
 */
export function can(
  subject: AuthSubject,
  action: string,
  resource?: ResourceContext,
): boolean {
  return authorize(subject, action, resource).allowed;
}
