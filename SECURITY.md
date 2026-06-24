<!-- Argus — Monitoring Platform · Author: Brijesh Dave (https://github.com/brijeshdave) -->
# Security Policy

## Supported versions

The latest released version receives security fixes. Older versions are not
maintained — please upgrade before reporting.

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅        |

## Reporting a vulnerability

**Please do not open a public issue, PR or discussion for security problems.**

Report privately via **GitHub → the repository → Security → "Report a
vulnerability"** (private vulnerability reporting), or contact the maintainer
through the [author's GitHub profile](https://github.com/brijeshdave).

Please include:

- a description and impact,
- steps to reproduce (or a proof of concept),
- affected version/commit and environment.

## What to expect

- Acknowledgement of your report as soon as possible.
- An assessment and, where valid, a fix on a coordinated timeline.
- Credit in the release notes if you'd like it.

Please give a reasonable window to fix and release before any public disclosure.

## Scope & notes

- Public surfaces (the `/status` page and `/docs`) are designed to expose only
  coarse, hand-picked data.
- Secrets are encrypted at rest (AES-256-GCM); never include real secrets in a
  report.
- Documented, accepted trade-offs are listed in
  [`docs/security.md`](docs/security.md).
