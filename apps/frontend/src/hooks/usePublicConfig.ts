/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Public status-page admin data hook: loads the current config plus the agent and
 * monitor catalogues (needed to pick items), and exposes a save action. All
 * fetching lives here; the page stays presentational.
 */
import { useCallback, useEffect, useState } from "react";
import type { AgentDTO, MonitorDTO, PublicConfigDTO } from "@argus/shared";
import { api } from "@/lib/api";

interface ListResponse<T> {
  rows: T[];
}

interface UsePublicConfig {
  loading: boolean;
  error: string | null;
  config: PublicConfigDTO | null;
  agents: AgentDTO[];
  monitors: MonitorDTO[];
  reload: () => void;
  save: (config: PublicConfigDTO) => Promise<void>;
}

export function usePublicConfig(): UsePublicConfig {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<PublicConfigDTO | null>(null);
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [monitors, setMonitors] = useState<MonitorDTO[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, a, m] = await Promise.all([
        api.get<PublicConfigDTO>("/api/public/config"),
        api.get<ListResponse<AgentDTO>>("/api/agents"),
        api.get<ListResponse<MonitorDTO>>("/api/monitors"),
      ]);
      setConfig(cfg);
      setAgents(a.rows);
      setMonitors(m.rows);
    } catch {
      setError("Failed to load public status configuration.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (next: PublicConfigDTO) => {
      const saved = await api.put<PublicConfigDTO>("/api/public/config", next);
      setConfig(saved);
    },
    [],
  );

  return { loading, error, config, agents, monitors, reload: () => void load(), save };
}
