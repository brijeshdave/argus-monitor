---
title: Troubleshooting
order: 80
---

## I forgot the admin password / I'm locked out

Recover it offline from the host shell — this bypasses the API, so it works even if
you're the only user and can't sign in:

```bash
./argus reset-password                          # reset the owner, prints a new password
./argus reset-password <username>               # reset a specific user
./argus reset-password <username> <password>    # set an explicit password
./argus reset-password <username> --reset-2fa   # also clear TOTP two-factor
```

It clears any login lockout and invalidates all existing sessions for that account.
Sign in with the printed password, then change it under **Profile**.

> Requires shell access to the host running Argus. If you also lost your 2FA device,
> add `--reset-2fa`.

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
