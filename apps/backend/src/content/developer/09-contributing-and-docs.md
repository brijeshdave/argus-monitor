---
title: Contributing, licensing & editing docs
order: 90
---

## Contributing & licensing

> **Note:** This project was built with an AI-assisted, "vibe-coding" workflow, and
> is backed by an automated test suite (unit + integration) with changes exercised
> against a running stack before release. Contributions are reviewed the same way.

Argus is **dual-licensed**: AGPL-3.0 for open-source/self-hosted use, plus a separate
commercial licence (see `COMMERCIAL.md`). The copyright is held in full by the
author.

- Keep changes small and reviewable; update docs in the same change.
- Run `pnpm -r typecheck` and `pnpm -r test` before committing; build the frontend
  for UI changes.
- Add an author header + one-line purpose to every new source file.
- Contributions are accepted on the basis that the author may relicense them
  (including commercially) — a CLA may be requested for substantial work.

## Editing the documentation

Docs are **Markdown files in the repository** — no code changes are needed to add or
edit a page, so the maintainer or the community can manage them via normal pull
requests.

- **Public help centre** (`/docs`) → `apps/frontend/src/content/help/*.md`
- **Developer docs** (`/developers`, gated) → `apps/backend/src/content/developer/*.md`

Each file starts with frontmatter:

```text
---
title: Installation     # shown in the sidebar / table of contents
order: 20               # ascending sort within the doc set
faq: false              # optional — render "## Question" blocks as an accordion
---
# ...Markdown body...
```

To add a page, drop a new `.md` file in the relevant folder with `title` and `order`
and open a pull request. To edit one, change its Markdown and submit a PR. The help
centre is bundled into the frontend at build time; the developer docs are read by the
backend at runtime and served only to holders of the `developer:read` permission.
Update the relevant docs whenever you change a feature.
