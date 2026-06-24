---
title: Environment configuration
order: 50
---

All configuration comes from the environment (never committed literals). Copy
`.env.example` to `.env` and fill it in. Key variables:

- **Databases** — connection settings for the `master` and `telemetry` PostgreSQL
  databases (host, port, user, password, names). Dev/test can use embedded PGlite.
- **Auth** — the JWT signing secret and the AES-256-GCM encryption key for secrets
  at rest. Generate strong random values; rotating the encryption key requires
  re-encrypting stored secrets.
- **REDIS_ENABLED** — `true` to use Redis + BullMQ queues (multi-node / separate
  worker host); `false` for single-node in-process mode.
- **TRUST_PROXY** — off by default. Set to `true`, a hop count, or a subnet CSV so
  Argus reads the real client IP from `X-Forwarded-For` behind your proxy.
- **VITE_BRAND_NAME / VITE_BRAND_TAGLINE** — build-time white-label branding
  (defaults "Argus" / "Monitoring"). There is no runtime/in-app branding setting by
  design.

> Secrets live only in env/UI and are stored AES-256-GCM encrypted. Never commit
> `.env`; provide `.example` files. The audit/log redactor scrubs secret-looking
> fields automatically.
