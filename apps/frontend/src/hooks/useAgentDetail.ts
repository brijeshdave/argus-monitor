/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Agent-detail data hook: loads one agent, its monitors, recent commands and
 * recent historical log lines (newest-first from REST, presented oldest-first so
 * they precede the live tail). All fetching lives here; the page only renders.
 */
import { useCallback, useEffect, useState } from "react";
import type { AgentCommandDTO, AgentDTO, MonitorDTO, Page } from "@argus/shared";
import { api } from "@/lib/api";

/** A persisted log row as returned by GET /api/logs (telemetry `logs` table). */
export interface LogRow {
  id: string;
  category: string;
  level: string;
  sourceId: string | null;
  message: string;
  context: Record<string, unknown> | null;
  ts: string;
}

interface UseAgentDetail {
  loading: boolean;
  error: string | null;
  agent: AgentDTO | null;
  monitors: MonitorDTO[];
  commands: AgentCommandDTO[];
  /** Recent historical logs, oldest-first (so the live tail continues the console). */
  logs: LogRow[];
  reload: () => void;
}

export function useAgentDetail(id: string): UseAgentDetail {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentDTO | null>(null);
  const [monitors, setMonitors] = useState<MonitorDTO[]>([]);
  const [commands, setCommands] = useState<AgentCommandDTO[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, m, c, l] = await Promise.all([
        api.get<{ agent: AgentDTO }>(`/api/agents/${id}`),
        api.get<{ rows: MonitorDTO[] }>(`/api/monitors?agentId=${encodeURIComponent(id)}`),
        api.get<{ rows: AgentCommandDTO[] }>(`/api/agents/${id}/commands`),
        api.get<Page<LogRow>>(`/api/logs?sourceId=${encodeURIComponent(id)}&limit=100`),
      ]);
      setAgent(a.agent);
      setMonitors(m.rows);
      setCommands(c.rows);
      // REST returns newest-first; reverse so the console reads oldest → newest.
      setLogs([...l.rows].reverse());
    } catch {
      setError("Failed to load agent.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    loading,
    error,
    agent,
    monitors,
    commands,
    logs,
    reload: () => void load(),
  };
}
