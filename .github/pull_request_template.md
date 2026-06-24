<!-- Argus — Monitoring Platform · Author: Brijesh Dave (https://github.com/brijeshdave) -->
## Summary

<!-- What does this change and why? -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Documentation
- [ ] Other:

## How was it tested?

<!-- Commands run, manual steps, screenshots for UI changes -->

## Checklist

- [ ] `pnpm -r typecheck` passes
- [ ] `pnpm -r test` passes
- [ ] UI change → `pnpm --filter @argus/frontend build` passes
- [ ] Agent change → `go build ./... && go vet ./... && go test ./...` passes (in `agent/`)
- [ ] Documentation updated (help / developer docs) if behaviour changed
- [ ] Commits are signed off (`git commit -s`) per the [DCO](https://developercertificate.org/)
- [ ] No secrets, credentials or `.env` values committed
