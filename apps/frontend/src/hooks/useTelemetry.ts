/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Telemetry data hooks. A generic paginated-list hook (logs / audit /
 * notifications) plus a simple uptime fetch hook. All fetching lives here so the
 * telemetry pages stay presentational. Rows are intentionally loosely typed
 * (Record) — the telemetry tables are append-only and shape-flexible.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

/** A telemetry row — flexible by design; pages read the fields they render. */
export type TelemetryRow = Record<string, unknown>;

interface PagedResponse {
  rows: TelemetryRow[];
  total: number;
  limit: number;
  offset: number;
}

interface UptimeRow {
  sourceId: string;
  entity: string;
  bucketStart: string;
  upSec: number;
  totalSec: number;
}

interface UptimeResponse {
  rows: UptimeRow[];
}

export interface PagedList {
  loading: boolean;
  error: string | null;
  rows: TelemetryRow[];
  total: number;
  limit: number;
  offset: number;
  page: number;
  pageCount: number;
  setOffset: (offset: number) => void;
  next: () => void;
  prev: () => void;
  reload: () => void;
}

/** Build a `?k=v` query string, skipping empty / undefined params. */
function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

/**
 * Generic paginated telemetry list. `path` is the bare endpoint (e.g.
 * "/api/logs"); `filters` are merged with limit/offset. Changing filters resets
 * to the first page.
 */
export function usePagedList(
  path: string,
  filters: Record<string, string | undefined>,
  limit = 50,
): PagedList {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TelemetryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  // Stable key so filter object identity changes don't loop the effect.
  const filterKey = JSON.stringify(filters);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = buildQuery({ ...filters, limit, offset });
      const res = await api.get<PagedResponse>(`${path}${query}`);
      setRows(res.rows);
      setTotal(res.total);
    } catch {
      setError("Failed to load data.");
    } finally {
      setLoading(false);
    }
    // filters captured via filterKey to keep deps stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, limit, offset, filterKey]);

  // Reset to first page whenever the filters change.
  useEffect(() => {
    setOffset(0);
  }, [filterKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(offset / limit) + 1;

  return {
    loading,
    error,
    rows,
    total,
    limit,
    offset,
    page,
    pageCount,
    setOffset,
    next: () => setOffset((o) => (o + limit < total ? o + limit : o)),
    prev: () => setOffset((o) => Math.max(0, o - limit)),
    reload: () => void load(),
  };
}

export interface AgentOption {
  id: string;
  name: string;
}

/** Fetch the agent list once for source/host filter dropdowns. */
export function useAgentOptions(): AgentOption[] {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  useEffect(() => {
    void api
      .get<{ rows: Array<{ id: string; name: string }> }>("/api/agents")
      .then((r) => setAgents(r.rows.map((a) => ({ id: a.id, name: a.name }))))
      .catch(() => setAgents([]));
  }, []);
  return agents;
}

export interface UptimeData {
  loading: boolean;
  error: string | null;
  rows: UptimeRow[];
  overallPct: number | null;
  fetchUptime: (sourceId: string, entity: string, hours?: number) => void;
}

/** Fetch uptime buckets on demand and derive the overall uptime percentage. */
export function useUptime(): UptimeData {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<UptimeRow[]>([]);

  const fetchUptime = useCallback((sourceId: string, entity: string, hours?: number) => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const query = buildQuery({ sourceId, entity, hours });
        const res = await api.get<UptimeResponse>(`/api/uptime${query}`);
        setRows(res.rows);
      } catch {
        setError("Failed to load uptime.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const overallPct = useMemo(() => {
    if (rows.length === 0) return null;
    const up = rows.reduce((sum, r) => sum + r.upSec, 0);
    const total = rows.reduce((sum, r) => sum + r.totalSec, 0);
    return total > 0 ? (up / total) * 100 : null;
  }, [rows]);

  return { loading, error, rows, overallPct, fetchUptime };
}
