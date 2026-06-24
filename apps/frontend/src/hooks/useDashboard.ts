/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Dashboard data hook: fetches agents + monitors and derives summary counts.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentDTO, MonitorDTO } from "@argus/shared";
import { api } from "@/lib/api";

interface ListResponse<T> {
  rows: T[];
}

interface DashboardSummary {
  totalAgents: number;
  approvedAgents: number;
  pendingAgents: number;
  totalMonitors: number;
}

interface UseDashboard {
  loading: boolean;
  error: string | null;
  agents: AgentDTO[];
  monitors: MonitorDTO[];
  summary: DashboardSummary;
  reload: () => void;
}

/** @param pollMs when set, silently re-fetches agents+monitors on that interval so
 *  added/removed hosts surface without a page reload (e.g. on the wallboard). */
export function useDashboard(pollMs?: number): UseDashboard {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [monitors, setMonitors] = useState<MonitorDTO[]>([]);

  // `silent` refreshes don't toggle the loading flag, so background polling never
  // flashes a spinner over a live wall.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [a, m] = await Promise.all([
        api.get<ListResponse<AgentDTO>>("/api/agents"),
        api.get<ListResponse<MonitorDTO>>("/api/monitors"),
      ]);
      setAgents(a.rows);
      setMonitors(m.rows);
    } catch {
      setError("Failed to load dashboard data.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!pollMs) return;
    const t = setInterval(() => void load(true), pollMs);
    return () => clearInterval(t);
  }, [pollMs, load]);

  const summary = useMemo<DashboardSummary>(
    () => ({
      totalAgents: agents.length,
      approvedAgents: agents.filter((x) => x.status === "approved").length,
      pendingAgents: agents.filter((x) => x.status === "pending").length,
      totalMonitors: monitors.length,
    }),
    [agents, monitors],
  );

  return { loading, error, agents, monitors, summary, reload: () => void load() };
}
