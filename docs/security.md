<!-- Argus — Monitoring Platform · Author: Brijesh Dave (https://github.com/brijeshdave) -->
# Security posture

Summary of the controls implemented across the platform. See the code for detail;
this is the map.

## Authentication
- **Local:** scrypt password hashing ([`core/password`](../packages/core/src/password.ts)),
  self-describing parameters; constant-time verify.
- **Tokens:** short-lived JWT access + **rotating, hashed, single-use refresh tokens**
  (`refresh_tokens`); logout revokes. Optional static `ADMIN_TOKEN` for automation.
- **OIDC:** generic discovery + PKCE auth-code flow; federated users provisioned with
  **no groups** (no access until granted).

## Authorization (RBAC + ABAC)
- Users get access **only via groups → roles → permissions**; no direct user grants
  ([ADR-0004](adr/0004-rbac-abac.md)). Pure, unit-tested `authorize()` evaluator.
- The **owner + superadmin are immutable** (`assertMutable` guards every mutation).
- Every route declares the permission it needs (`requirePermission`).

## Secrets & data
- All secrets (connection/device keys, OIDC client secret, run-as creds) stored as
  **AES-256-GCM envelopes** with key-version rotation ([`core/crypto`](../packages/core/src/crypto.ts));
  never logged, never serialized into DTOs.
- **Audit:** every mutation writes a durable, **secret-redacted** row to the telemetry DB.
- **Public status** is secure-by-construction: coarse DTOs only (label/status/uptime) —
  ids/hostnames/ips cannot leak (asserted by test). Backups/reports download paths are
  **traversal-guarded**; restore is audited (destructive).

## Transport & edge
- TLS everywhere; optional **agent mTLS**; agents connect **outbound-only** (no inbound
  ports on monitored hosts). Helmet secure headers, CORS, **rate limiting**.
- **Proxy-aware:** `TRUST_PROXY` off by default; on only behind a trusted proxy.

## Agent safety
- Read-only by default; never touches monitored processes unless a separately-gated
  remediation feature is enabled. Resource rails + supervisor; disk store-and-forward.

## Hardening checklist (operators)
- [ ] Set a strong `ENCRYPTION_KEY` (`./argus gen-key`) and `JWT_SECRET`; rotate periodically.
- [ ] Change the seeded owner password on first login.
- [ ] Terminate TLS at the proxy/ingress; set `TRUST_PROXY` accordingly.
- [ ] Use sealed-secrets/external-secrets in Kubernetes (never commit secrets).
- [ ] Configure per-data-type retention; enable scheduled backups.
- [ ] Restrict the public status page exposure to only what should be public.

## Security review summary
A focused review of the key surfaces — clean, no critical findings:
- **Agent build-from-UI** uses `execFile` with an args array (no shell); `os`/`arch`
  are allowlist-validated before reaching the child-process env; downloads are
  path-traversal guarded; returns 503 when no Go toolchain is present.
- **Agent self-update** validates the URL scheme (http/https only), writes to a temp
  file beside the executable, and replaces it atomically (unix rename; Windows
  rename-self-then-replace with rollback on failure).
- **Operator WS** (`/ws`) verifies the JWT and requires `dashboard:read`; agent
  channels are connection-key authed and approval-gated.
- All config-mutating routes (settings/retention/public) are `requirePermission`-guarded.

**Accepted/documented trade-offs (not vulnerabilities):** self-update has no
signature/checksum yet (TODO — pin to artifacts from the trusted backend); the
connection key is baked into the installed service unit (revocable centrally from
the UI); run-as-user requires root on unix and is a Windows stub (gated/experimental).

## Reporting
Run a security review on changes before release. Report vulnerabilities privately to
the maintainer (see repository).
