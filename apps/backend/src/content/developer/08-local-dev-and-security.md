---
title: Local development & security
order: 80
---

## Commands

```bash
./argus up | down | restart | ps | logs | build   # Docker stack (bind mounts)
./argus migrate | seed | backup | restore          # database lifecycle
./argus agent-build [windows|linux|darwin|all]      # cross-compile the agent
./argus dev | install | gen-key | reset-password | doctor
pnpm -r build | test | typecheck                    # workspace-wide
```

> `./argus migrate` and `./argus seed` run inside the **built image** — rebuild
> (`./argus up`) BEFORE running them, or new migrations/seed code silently no-op.

## Security

- Per-agent connection keys (+ optional mTLS); JWT access + rotating refresh tokens;
  generic OIDC.
- RBAC/ABAC on every route; AES-256-GCM secrets at rest; rate limiting; secure
  headers.
- Full audit of every mutation (before→after diff); secrets redacted in logs +
  audit.
- Proxy-aware via `TRUST_PROXY` (off by default) so logs/sessions show the real
  client IP.
- Public surfaces (status page, /docs) are secure-by-construction — coarse DTOs /
  static content only.
