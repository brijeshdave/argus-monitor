---
title: RBAC / ABAC — adding a permission
order: 30
---

The permission catalogue is the single source of truth in
**packages/shared/src/rbac.ts**. To add a capability, edit it in one place:

1. Add the key(s) to **PERMISSION_CATALOGUE** (grouped by resource).
2. Add a **RESOURCE_META** entry (label + description) — also sets the picker tab
   order.
3. Add a **PERMISSION_DESCRIPTIONS** entry (friendly tooltip + seeded description).
4. Grant it in **SYSTEM_ROLE_PERMISSIONS** as needed (superadmin = `*`, auto-gets
   everything).
5. Enforce it on the route with `app.requirePermission("resource:action")` and gate
   the UI with `has("resource:action")`.

> The seed is **self-healing**: it upserts keys + descriptions and prunes any
> permission row not in the catalogue (role_permissions cascade). Retiring a
> permission = delete it from the catalogue, then `./argus seed`.

Prefer reusing existing permissions over inventing new ones (scans→monitors:write,
debug/multi-host→agents:write, OIDC→settings:*, backup schedules→backups:run).

How access is resolved at request time: `subject.ts` joins user → groups → roles →
permissions into an effective permission set (plus ABAC attributes and the owner
flag); `requirePermission` checks that set, and owners bypass.
