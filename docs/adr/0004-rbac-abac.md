<!-- Argus · Author: Brijesh Dave (https://github.com/brijeshdave) -->
# ADR-0004 — Authorization: group-based RBAC with ABAC refinement

**Status:** accepted · **Date:** 2026-06-14

## Context
v1 had four fixed roles assigned directly to users. The platform needs UI-managed,
flexible access control with groups, multiple roles, and attribute scoping.

## Decision
- **Users → Groups → Roles → Permissions.** Users get access **only** via groups.
  A group may hold **multiple roles**. Roles carry `resource:action` permissions.
- **No direct user→role or user→permission edges** (enforced in schema + service).
- **ABAC** attributes (on subjects and resources) refine access, e.g. site/tag scoping.
- The `superadmin` role and the bootstrap superadmin user are **`isSystem` = immutable**
  (cannot be edited, demoted, disabled or deleted). Seeded roles/groups/permissions
  ship by default.

## Rationale
- Group-only assignment scales to org structures and is auditable.
- A flat `resource:action` permission catalogue lets new monitor types/features
  register permissions without schema migrations.
- ABAC covers per-site/per-tenant scoping without role explosion.

## Consequences
- A single `authorize(subject, action, resource)` evaluator in `@argus/core`,
  unit-tested in isolation, is the one enforcement point.
