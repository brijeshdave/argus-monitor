# Argus — Monitoring Platform
# Author: Brijesh Dave <https://github.com/brijeshdave>
#
# Container image for running the Argus agent INSIDE a NAS (e.g. QNAP QuTS hero
# Container Station). Bind-mount the share read-only and the agent walks it on the
# LOCAL filesystem — full recursive folder sizes + file/subfolder counts at any
# depth, in seconds, with no SMB enumeration cost. Builds fully offline from the
# vendored module cache.
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY . .
ARG VERSION=1.0.0
ARG BUILT=unknown
ENV GOFLAGS=-mod=vendor GOTOOLCHAIN=local CGO_ENABLED=0
RUN go build -trimpath \
  -ldflags "-s -w -X main.Version=${VERSION} -X github.com/brijeshdave/argus-monitor/agent/internal/collect.BuildTime=${BUILT}" \
  -o /out/argus-agent ./cmd/agent

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && mkdir -p /var/lib/argus
COPY --from=build /out/argus-agent /usr/local/bin/argus-agent
# Disk-backed store-and-forward survives restarts when /var/lib/argus is a volume.
ENV ARGUS_SPOOL_DIR=/var/lib/argus
# Provide ARGUS_KEY (UI connection key) and ARGUS_SERVER (wss/https backend URL).
ENTRYPOINT ["argus-agent", "run"]
