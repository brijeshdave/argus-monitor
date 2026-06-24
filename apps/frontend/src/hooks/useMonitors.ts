/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Monitors page data hook: fetches monitors (optionally scoped to an agent) plus
 * the agent list (for the create-form picker) and exposes CRUD actions. All
 * fetching lives here; the page stays presentational.
 */
import { useCallback, useEffect, useState } from "react";
import type { AgentDTO, MonitorDTO, MonitorType } from "@argus/shared";
import { api } from "@/lib/api";

interface ListResponse<T> {
  rows: T[];
}

/** Payload for creating a monitor (POST /api/monitors). */
export interface MonitorCreate {
  agentId: string;
  type: MonitorType;
  name: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

/** Partial update payload (PATCH /api/monitors/:id). */
export interface MonitorUpdate {
  name?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

interface UseMonitors {
  loading: boolean;
  error: string | null;
  monitors: MonitorDTO[];
  agents: AgentDTO[];
  agentId: string;
  setAgentId: (id: string) => void;
  reload: () => void;
  create: (input: MonitorCreate) => Promise<void>;
  update: (id: string, patch: MonitorUpdate) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useMonitors(): UseMonitors {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monitors, setMonitors] = useState<MonitorDTO[]>([]);
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [agentId, setAgentId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
      const [m, a] = await Promise.all([
        api.get<ListResponse<MonitorDTO>>(`/api/monitors${query}`),
        api.get<ListResponse<AgentDTO>>("/api/agents"),
      ]);
      setMonitors(m.rows);
      setAgents(a.rows);
    } catch {
      setError("Failed to load monitors.");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: MonitorCreate) => {
      await api.post("/api/monitors", input);
      await load();
    },
    [load],
  );

  const update = useCallback(
    async (id: string, patch: MonitorUpdate) => {
      await api.patch(`/api/monitors/${id}`, patch);
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.del(`/api/monitors/${id}`);
      await load();
    },
    [load],
  );

  return {
    loading,
    error,
    monitors,
    agents,
    agentId,
    setAgentId,
    reload: () => void load(),
    create,
    update,
    remove,
  };
}
