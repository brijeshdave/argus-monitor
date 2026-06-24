/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Guards for protected system entities. The seeded superadmin role and the owner
 * user (is_system / is_owner) must never be edited, disabled, demoted or deleted.
 * Services call these before any mutating operation so the rule is enforced in
 * exactly one place (DRY).
 */
export class ProtectedEntityError extends Error {
  readonly code = "protected_entity";
  constructor(message: string) {
    super(message);
    this.name = "ProtectedEntityError";
  }
}

export interface Protectable {
  isSystem?: boolean | null;
  isOwner?: boolean | null;
}

/** Throw if the entity is a protected system/owner record. `what` names it for the error. */
export function assertMutable(entity: Protectable, what: string): void {
  if (entity.isSystem || entity.isOwner) {
    throw new ProtectedEntityError(`${what} is a protected system entity and cannot be modified or deleted.`);
  }
}

/** Non-throwing variant for UI/pre-checks. */
export function isProtected(entity: Protectable): boolean {
  return Boolean(entity.isSystem || entity.isOwner);
}
