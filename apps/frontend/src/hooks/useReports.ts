/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Reports data hook: lists report files, generates an on-demand report, downloads
 * a report file (authenticated blob → browser save), and loads the agent/monitor
 * options used to scope a report. All fetching lives here; the page stays
 * presentational.
 */
import { useCallback, useEffect, useState } from "react";
import type { ReportMeta, ReportRequest } from "@argus/shared";
import { api } from "@/lib/api";
import { getAccess } from "@/lib/tokens";

/** Minimal agent/monitor shapes the scope selects need. */
export interface ReportScopeAgent {
  id: string;
  name: string;
}
export interface ReportScopeMonitor {
  id: string;
  name: string;
}

interface ReportListResponse {
  rows: ReportMeta[];
}

interface UseReports {
  loading: boolean;
  error: string | null;
  reports: ReportMeta[];
  agents: ReportScopeAgent[];
  monitors: ReportScopeMonitor[];
  reload: () => void;
  generate: (req: ReportRequest) => Promise<void>;
  preview: (req: ReportRequest) => Promise<ReportDoc>;
  open: (name: string) => Promise<ReportDoc>;
  download: (name: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
}

/** The report document returned by /api/reports/data (mirrors the backend shape). */
export interface ReportDoc {
  type: ReportRequest["type"];
  scope: ReportRequest["scope"];
  days: number;
  from?: string;
  to?: string;
  generatedAt: string;
  scopeLabel?: string;
  windowLabel?: string;
  data: unknown;
}

export function useReports(): UseReports {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [agents, setAgents] = useState<ReportScopeAgent[]>([]);
  const [monitors, setMonitors] = useState<ReportScopeMonitor[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, agentList, monitorList] = await Promise.all([
        api.get<ReportListResponse>("/api/reports"),
        api.get<{ rows: ReportScopeAgent[] }>("/api/agents"),
        api.get<{ rows: ReportScopeMonitor[] }>("/api/monitors"),
      ]);
      setReports(list.rows);
      setAgents(agentList.rows.map((a) => ({ id: a.id, name: a.name })));
      setMonitors(monitorList.rows.map((m) => ({ id: m.id, name: m.name })));
    } catch {
      setError("Failed to load reports.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = useCallback(
    async (req: ReportRequest) => {
      await api.post("/api/reports", req);
      await load();
    },
    [load],
  );

  const preview = useCallback((req: ReportRequest) => api.post<ReportDoc>("/api/reports/data", req), []);

  // Re-open a saved snapshot: fetch the stored JSON and parse it back into a
  // ReportDoc so the page can re-render its tables + charts (and re-export).
  const open = useCallback(async (name: string): Promise<ReportDoc> => {
    const headers: Record<string, string> = {};
    const token = getAccess();
    if (token) headers.Authorization = `Bearer ${token}`;
    const raw = await fetch(`/api/reports/${encodeURIComponent(name)}/download`, { headers });
    if (!raw.ok) throw new Error("open failed");
    return (await raw.json()) as ReportDoc;
  }, []);

  const download = useCallback(async (name: string) => {
    // The download endpoint needs a bearer header, so fetch as a blob (the shared
    // api client parses JSON bodies) and trigger a browser save from an object URL.
    const headers: Record<string, string> = {};
    const token = getAccess();
    if (token) headers.Authorization = `Bearer ${token}`;
    const raw = await fetch(`/api/reports/${encodeURIComponent(name)}/download`, { headers });
    if (!raw.ok) throw new Error("download failed");
    const blob = await raw.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const remove = useCallback(
    async (name: string) => {
      await api.del(`/api/reports/${encodeURIComponent(name)}`);
      await load();
    },
    [load],
  );

  return {
    loading,
    error,
    reports,
    agents,
    monitors,
    reload: () => void load(),
    generate,
    preview,
    open,
    download,
    remove,
  };
}
