/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * OIDC provider admin data hook: loads providers + the IdP redirect URI and exposes
 * create/update/delete. The client secret is write-only (sent, never returned).
 */
import { useCallback, useEffect, useState } from "react";
import type { CreateOidcProviderRequest, OidcProviderDTO, UpdateOidcProviderRequest } from "@argus/shared";
import { api } from "@/lib/api";

interface ListResponse {
  rows: OidcProviderDTO[];
}

export function useOidc() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<OidcProviderDTO[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ListResponse>("/api/oidc-providers");
      setProviders(res.rows);
      setError(null);
    } catch {
      setError("Failed to load OIDC providers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(async (input: CreateOidcProviderRequest) => {
    await api.post("/api/oidc-providers", input);
    await reload();
  }, [reload]);

  const update = useCallback(async (id: string, patch: UpdateOidcProviderRequest) => {
    await api.patch(`/api/oidc-providers/${id}`, patch);
    await reload();
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    await api.del(`/api/oidc-providers/${id}`);
    await reload();
  }, [reload]);

  return { loading, error, providers, create, update, remove, reload };
}
