# Argus — Monitoring Platform · Author: Brijesh Dave <https://github.com/brijeshdave>
# Thin wrapper over ./argus for those who prefer `make`.
.PHONY: up down restart ps logs build migrate seed backup dev install doctor help

help:        ; @./argus help
up:          ; @./argus up
down:        ; @./argus down
restart:     ; @./argus restart
ps:          ; @./argus ps
logs:        ; @./argus logs
build:       ; @./argus build
migrate:     ; @./argus migrate
seed:        ; @./argus seed
backup:      ; @./argus backup
dev:         ; @./argus dev
install:     ; @./argus install
doctor:      ; @./argus doctor
