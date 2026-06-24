<!-- Argus — Monitoring Platform · Author: Brijesh Dave (https://github.com/brijeshdave) -->
# Contributing to Argus

Thanks for your interest in improving Argus. This guide covers how to propose
changes and the terms under which contributions are accepted.

## Before you start

- Read the architecture and conventions in the **Developer docs** (`/developers`
  in the app) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) /
  [`docs/adr/`](docs/adr/).
- For anything non-trivial, **open an issue first** to discuss the approach before
  writing code.
- Found a security issue? **Do not open a public issue** — see
  [`SECURITY.md`](SECURITY.md).

## Development setup

```bash
git clone <repo-url> argus && cd argus
cp .env.example .env        # set DB creds, JWT secret, encryption key
pnpm install
pnpm -r build
./argus up                  # or run services from source — see /docs Installation
```

## Workflow

1. **Fork** the repository and create a branch off `main`
   (`git checkout -b fix/short-description`).
2. Make focused changes — keep PRs small and reviewable; one logical change per PR.
3. Update documentation in the same PR when behaviour changes
   (`apps/frontend/src/content/help/*.md` for users,
   `apps/backend/src/content/developer/*.md` for developers).
4. Run the checks below and make sure they pass.
5. Open a **pull request** against `main`, fill in the template, and reference the
   related issue.

## Checks (must pass)

```bash
pnpm -r typecheck
pnpm -r test
# UI changes:
pnpm --filter @argus/frontend build
# Agent changes:
cd agent && go build ./... && go vet ./... && go test ./...
```

## Coding standards

- TypeScript strict, no `any`; validate inbound payloads with zod matching
  `@argus/shared`; no business logic in routes (use `@argus/core`).
- Go: `gofmt`/`go vet` clean; never panic in the collect/push loop.
- React: data fetching in hooks, Tailwind utilities + shared tokens.
- Add the author header + a one-line purpose to every new source file.
- Least dependencies — justify any new one.

## Sign-off (DCO)

Every commit must be signed off under the
[Developer Certificate of Origin](https://developercertificate.org/). Add a
sign-off line with `-s`:

```bash
git commit -s -m "fix: ..."
```

This adds `Signed-off-by: Your Name <you@example.com>`, certifying you wrote the
change (or have the right to submit it) and agree to the licensing terms below.

## Licensing of contributions

Argus is **dual-licensed** — GNU AGPL-3.0 ([`LICENSE`](LICENSE)) plus a commercial
license ([`COMMERCIAL.md`](COMMERCIAL.md)). By submitting a contribution you agree
that it is provided under the AGPL-3.0 **and** that the project maintainer may also
distribute it under the commercial license (i.e. you grant the right to relicense
your contribution commercially). This is what keeps dual-licensing possible. A
formal CLA may be requested for substantial contributions.

## Code review

A maintainer will review your PR, possibly request changes, and merge with
**squash** once approved. Thanks for contributing!
