# Argus — Monitoring Platform · Author: Brijesh Dave <https://github.com/brijeshdave>
# Frontend image: build the SPA with Node, serve static assets with nginx.
# Build context = repository root (pnpm workspace).
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
# White-label branding is baked at build time (no runtime/in-app setting).
ARG VITE_BRAND_NAME=
ARG VITE_BRAND_TAGLINE=
ENV VITE_BRAND_NAME=${VITE_BRAND_NAME}
ENV VITE_BRAND_TAGLINE=${VITE_BRAND_TAGLINE}
RUN pnpm --filter @argus/shared build && pnpm --filter @argus/frontend build

FROM nginx:1.27-alpine AS runtime
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80
