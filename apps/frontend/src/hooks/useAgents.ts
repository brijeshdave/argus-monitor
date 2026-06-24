/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Agents page data hook: fetches agents + connection keys and exposes the
 * lifecycle actions (approve/revoke, mint/revoke key). All fetching lives here.
 */
import { useCallback, useEffect, useState } from "react";
import type { AgentDTO, ConnectionKeyDTO } from "@argus/shared";
import { api } from "@/lib/api";

interface ListResponse<T> {
  rows: T[];
}

/** The one-time secret returned by POST /api/agent-keys (shown once). */
export interface MintedKey {
  keyId: string;
  key: string;
}

interface UseAgents {
  loading: boolean;
  error: string | null;
  agents: AgentDTO[];
  keys: ConnectionKeyDTO[];
  reload: () => void;
  approve: (id: string) => Promise<void>;
  revoke: (id: string) => Promise<void>;
  update: (id: string) => Promise<void>;
  mintKey: (label: string) => Promise<MintedKey>;
  revokeKey: (id: string) => Promise<void>;
  createDevice: (name: string, address?: string) => Promise<void>;
}

export function useAgents(): UseAgents {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [keys, setKeys] = useState<ConnectionKeyDTO[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, k] = await Promise.all([
        api.get<ListResponse<AgentDTO>>("/api/agents"),
        api.get<ListResponse<ConnectionKeyDTO>>("/api/agent-keys"),
      ]);
      setAgents(a.rows);
      setKeys(k.rows);
    } catch {
      setError("Failed to load agents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = useCallback(
    async (id: string) => {
      await api.post(`/api/agents/${id}/approve`);
      await load();
    },
    [load],
  );

  const revoke = useCallback(
    async (id: string) => {
      await api.post(`/api/agents/${id}/revoke`);
      await load();
    },
    [load],
  );

  const update = useCallback(async (id: string) => {
    // Queues an update command over the agent control channel; no list change.
    await api.post(`/api/agents/${id}/update`, {});
  }, []);

  const mintKey = useCallback(
    async (label: string): Promise<MintedKey> => {
      const res = await api.post<MintedKey>("/api/agent-keys", { label });
      await load();
      return res;
    },
    [load],
  );

  const revokeKey = useCallback(
    async (id: string) => {
      await api.post(`/api/agent-keys/${id}/revoke`);
      await load();
    },
    [load],
  );

  const createDevice = useCallback(
    async (name: string, address?: string) => {
      await api.post("/api/agents/device", { name, ...(address ? { address } : {}) });
      await load();
    },
    [load],
  );

  return {
    loading,
    error,
    agents,
    keys,
    reload: () => void load(),
    approve,
    revoke,
    update,
    mintKey,
    revokeKey,
    createDevice,
  };
}
