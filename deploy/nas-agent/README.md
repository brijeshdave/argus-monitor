# Argus agent on the NAS (Container Station)

Run the Argus agent **inside** the NAS so it reads shares on the **local
filesystem** — full recursive folder sizes + file/subfolder counts at any depth, in
seconds, with no SMB enumeration. This is the efficient way to get folder stats for
huge shares (millions of files), where probing over SMB from the Argus host is too
slow.

## Build the image

On any machine with Docker + this repo (or on the NAS itself):

```bash
docker build -t argus-agent:latest \
  --build-arg VERSION="$(cat agent/VERSION)" \
  --build-arg BUILT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  agent
```

Push it to your registry, or `docker save argus-agent:latest | gzip > argus-agent.tgz`
and import it in **Container Station → Images → Import**.

## Run it (QuTS hero Container Station)

1. **Argus UI → Agents → New connection key** — copy the key.
2. Edit [`docker-compose.yml`](docker-compose.yml):
   - `ARGUS_SERVER` = your backend URL (e.g. `https://argus.example.com`).
   - `ARGUS_KEY` = the connection key.
   - The `/data` volume = the host path to your data, **read-only**. On QuTS hero
     shares usually live under `/share/<POOL>/<share>` (or `/share/<share>`); mount
     the parent so all shares are visible under `/data`.
3. `docker compose up -d` — or in Container Station, **Applications → Create →
   import this compose**.
4. **Argus UI → Agents** — approve the new agent.
5. Add a **Storage** monitor on that agent: path `/data/<share>` and watched folders
   relative to it. Because the walk is local, you can set **depth as deep as your
   files** (e.g. 5–6) and get true file counts + sizes.

## Updating to a new version

The container is updated by **replacing the image** (not the in-app "Update" button —
that does a binary self-update which doesn't persist in a container). The connection
key + `argus-agent-spool` volume persist, so it reconnects as the same agent with all
its monitors.

```bash
docker load -i /share/Public/argus-agent-qnap-latest.tar   # new :latest image
docker compose up -d --force-recreate                      # recreate from it
docker logs -f argus-agent                                 # confirm the new version
```

`pull_policy: never` keeps compose on the locally-loaded image. Confirm the running
version on **Argus UI → Agents** (the version + build time update after recreate).

## Notes

- The container needs **outbound** access to the backend (WSS + HTTPS). It opens no
  inbound ports.
- Mount data **read-only** (`:ro`) — the agent only observes.
- `argus-agent-spool` keeps disk-backed store-and-forward across restarts.
- One container can cover every share on that NAS (mount them all under `/data`).
