# Argus — Monitoring Platform · Author: Brijesh Dave <https://github.com/brijeshdave>
# Workers image. Build context = repository root. Deployable on a separate host.
FROM node:22-bookworm-slim AS deps
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/workers/package.json ./apps/workers/package.json
RUN pnpm install --frozen-lockfile || pnpm install

FROM deps AS build
COPY . .
RUN pnpm --filter @argus/shared --filter @argus/db --filter @argus/core build \
 && pnpm --filter @argus/workers build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# Same uid as the backend (10001): both share the ./data bind mount, so they need a
# common owner. The data-init service (compose) makes that mount writable on boot.
RUN corepack enable && useradd -r -u 10001 argus
WORKDIR /repo
COPY --from=build /repo .
USER argus
CMD ["node", "apps/workers/dist/index.js"]
