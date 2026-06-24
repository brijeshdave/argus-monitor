# Argus — Monitoring Platform
# Author: Brijesh Dave <https://github.com/brijeshdave>
#
# Caddy reverse proxy with the Cloudflare DNS plugin compiled in, so it can solve
# the ACME DNS-01 challenge (no inbound :80 needed for issuance). It terminates TLS
# for the whole stack and proxies to the frontend, which already forwards /api + /ws
# to the backend. Opt-in: only built/run under the compose `tls` profile.
ARG CADDY_VERSION=2.8.4

FROM caddy:${CADDY_VERSION}-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:${CADDY_VERSION}
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
