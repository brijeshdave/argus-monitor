<!-- Argus — Monitoring Platform · Author: Brijesh Dave (https://github.com/brijeshdave) -->
# Argus documentation

In-repo engineering documentation. End-user and operator how-tos, plus the full
installation guide, live in the in-app help centre at **`/docs`**; developer docs
(gated) at **`/developers`**. This folder holds the deeper, source-of-truth
engineering material.

## Index
- [Architecture](ARCHITECTURE.md) — system design and components.
- [Decision records](adr/) — why the key choices were made.
- [Security & secrets](security.md) — security posture and handling.
- [`ci.yml.example`](ci.yml.example) — sample CI pipeline.

## Quickstart
```bash
cp .env.example .env        # review values; ./argus gen-key for ENCRYPTION_KEY
./argus up                  # build + start the full stack (bind-mounted data)
./argus migrate && ./argus seed
# open http://localhost:8081
```
