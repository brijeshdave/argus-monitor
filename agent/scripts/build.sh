#!/usr/bin/env bash
# Argus — Monitoring Platform · Author: Brijesh Dave <https://github.com/brijeshdave>
# Cross-compile the agent for all supported platforms. The web UI invokes the
# same matrix (via a worker job) to produce downloadable, version-stamped builds.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Single source of truth for the agent version: the VERSION file (same value
# stamped into EVERY platform build). Override with ARGUS_VERSION; git describe
# is only a last-resort fallback.
VERSION="${ARGUS_VERSION:-$(tr -d '[:space:]' < VERSION 2>/dev/null || git describe --tags --always 2>/dev/null || echo 1.0.0)}"
OUT="dist"
LDFLAGS="-s -w -X main.Version=${VERSION}"
mkdir -p "$OUT"

build() {
  local goos="$1" goarch="$2" ext="${3:-}"
  echo "→ ${goos}/${goarch}"
  GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 \
    go build -ldflags "$LDFLAGS" -o "${OUT}/argus-agent-${goos}-${goarch}${ext}" ./cmd/agent
}

target="${1:-all}"
case "$target" in
  windows) build windows amd64 .exe ;;
  linux)   build linux amd64; build linux arm64 ;;
  darwin)  build darwin amd64; build darwin arm64 ;;
  all)
    build windows amd64 .exe
    build linux amd64; build linux arm64
    build darwin amd64; build darwin arm64
    ;;
  *) echo "usage: build.sh [windows|linux|darwin|all]"; exit 1 ;;
esac
echo "Built argus-agent ${VERSION} → ${OUT}/"
