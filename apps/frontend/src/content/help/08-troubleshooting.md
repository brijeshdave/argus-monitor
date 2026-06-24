---
title: Troubleshooting
order: 80
---

## An agent isn't connecting

- Confirm the host has **outbound** access to the backend (WSS + HTTPS).
- Check the connection key is valid and not revoked.
- Enable **debug mode** for the agent and watch the live logs.

## A host shows UNKNOWN

UNKNOWN means no recent data. The agent is likely offline or blocked — check its
process and network, and the Logs page for the last seen time.

## My migration or seed change didn't apply (Docker)

`./argus migrate` and `./argus seed` run from the built image. Run `./argus up` to
rebuild first, then migrate/seed.

## Logs/sessions show a proxy IP instead of the real client IP

Set `TRUST_PROXY` appropriately for your reverse-proxy chain so Argus reads the
forwarded client address.
