---
title: Account & administration
order: 70
---

## Your account & sessions

**Profile & password** — update your display name and change your password under
**Profile**. Changing your password does **not** sign out your current session, but
it ends all your other sessions for safety.

**Two-factor authentication** — enable TOTP 2FA from your profile for an extra layer
of security (any authenticator app works). If you lose your device, an administrator
can reset your 2FA so you can re-enrol.

**Active sessions** — see your own active sessions (device, IP, last used) and
terminate any you don't recognise. Each login is recorded. Superadmins can review
and terminate other users' sessions.

## Users, groups & roles (admins)

Access is granted **only** through groups: users belong to **groups**, groups carry
**roles**, and roles grant **permissions**. There is no direct user→role or
user→permission link.

- Create a **role** and tick its permissions (organised into tabs by area, each with
  a selected/total count).
- Create a **group** and give it one or more roles. **Clone** a role to start from
  an existing one.
- Add users to groups. The user editor shows a live preview of the user's
  **effective permissions**.
- Optionally set **ABAC attributes** (e.g. `site = plant-a`) on a user to refine
  scope.

## Backups & retention

Back up config-only, data-only or both, on a schedule, with retention rules (keep
the last N, plus daily/weekly/monthly copies). Restore from any backup, and download
or delete individual backups. Retention windows for metrics, logs and scan history
are configured under Settings.

## Settings & SSO

Configure data retention and connect a generic **OIDC** identity provider for single
sign-on under **Admin → Settings / SSO**.

> The bootstrap superadmin account and the `superadmin` role are protected — they
> cannot be edited, disabled or deleted. Product branding is set at deploy time only
> and has no in-app setting.
