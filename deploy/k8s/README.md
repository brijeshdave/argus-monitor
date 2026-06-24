<!-- Argus — Monitoring Platform · Author: Brijesh Dave (https://github.com/brijeshdave) -->
# Kubernetes deployment

Argus is Kubernetes-capable. This directory holds Kustomize bases + overlays.
Full manifests (Deployments, Services, Ingress, HPA, externalized Postgres/Redis,
PVCs, secrets via `ExternalSecrets`/sealed-secrets) are provided here.

```
k8s/
├── base/            # namespace + shared config
└── overlays/
    ├── dev/
    └── prod/
```

Design notes:
- Backend and workers scale independently; **workers require Redis** (the queue bus).
- Stateful Postgres/Redis are expected to be operator-managed or external in prod.
- Secrets are never baked into images — injected via env/Secret resources.
