---
title: API & route conventions
order: 70
---

- Routes are **thin**: validate the body with zod at the boundary, call into
  `@argus/core` / a service, return a DTO. No business logic in routes.
- Guard every mutating route with `app.authenticate` +
  `app.requirePermission("resource:action")`.
- Audit every mutation with
  `app.audit(req, { action, category, target, before?, after })` — include `before`
  for a meaningful diff.
- List endpoints return `{ rows: [...] }`; single-entity writes return
  `{ <entity>: {...} }`. Validation failures → 400 `{ error: "invalid_request" }`;
  missing → 404; protected entity → 403.
- Timestamps are ISO-8601 UTC in contracts — normalise Drizzle string timestamps at
  the DTO boundary.

```ts
app.post("/api/things", { preHandler: [app.authenticate, app.requirePermission("things:write")] },
  async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const thing = await createThing(app.master, parsed.data);
    await app.audit(req, { action: "thing.create", category: "things", target: thing.id, after: thing });
    return reply.code(201).send({ thing });
  });
```

> The audit redactor scrubs any object field whose name matches
> `pass|secret|token|key|cipher|credential|authorization`. Name fields accordingly
> (e.g. `permissions`, not `permissionKeys`) so non-secret lists survive in the
> audit log.
