/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Wallboard-layouts data hook: lists saved layouts and exposes create / clone /
 * delete. Single-layout loading + save lives in the builder's own hook below.
 */
import { useCallback, useEffect, useState } from "react";
import type { WallLayoutDTO, WallPanelConfig, WallTemplate } from "@argus/shared";
import { api } from "@/lib/api";

interface ListResponse<T> {
  rows: T[];
}

interface LayoutResponse {
  layout: WallLayoutDTO;
}

interface UseWallboards {
  loading: boolean;
  error: string | null;
  layouts: WallLayoutDTO[];
  reload: () => void;
  create: (name: string, description?: string, layout?: Record<string, unknown>) => Promise<WallLayoutDTO>;
  clone: (id: string, name: string) => Promise<WallLayoutDTO>;
  remove: (id: string) => Promise<void>;
  setDefault: (id: string) => Promise<void>;
  setTemplate: (id: string, template: WallTemplate) => Promise<void>;
  setRotate: (id: string, rotateSec: number) => Promise<void>;
  setPanel: (id: string, panelConfig: WallPanelConfig) => Promise<void>;
}

export function useWallboards(): UseWallboards {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layouts, setLayouts] = useState<WallLayoutDTO[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ListResponse<WallLayoutDTO>>("/api/wallboards");
      setLayouts(res.rows);
    } catch {
      setError("Failed to load wallboards.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (name: string, description?: string, layout?: Record<string, unknown>): Promise<WallLayoutDTO> => {
      const res = await api.post<LayoutResponse>("/api/wallboards", { name, description, ...(layout ? { layout } : {}) });
      await load();
      return res.layout;
    },
    [load],
  );

  const clone = useCallback(
    async (id: string, name: string): Promise<WallLayoutDTO> => {
      const res = await api.post<LayoutResponse>(`/api/wallboards/${id}/clone`, { name });
      await load();
      return res.layout;
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.del(`/api/wallboards/${id}`);
      await load();
    },
    [load],
  );

  const setDefault = useCallback(
    async (id: string) => {
      await api.post(`/api/wallboards/${id}/default`, {});
      await load();
    },
    [load],
  );

  const setTemplate = useCallback(
    async (id: string, template: WallTemplate) => {
      await api.post(`/api/wallboards/${id}/template`, { template });
      await load();
    },
    [load],
  );

  const setRotate = useCallback(
    async (id: string, rotateSec: number) => {
      await api.post(`/api/wallboards/${id}/rotate`, { rotateSec });
      await load();
    },
    [load],
  );

  const setPanel = useCallback(
    async (id: string, panelConfig: WallPanelConfig) => {
      await api.post(`/api/wallboards/${id}/panel`, panelConfig);
      await load();
    },
    [load],
  );

  return { loading, error, layouts, reload: () => void load(), create, clone, remove, setDefault, setTemplate, setRotate, setPanel };
}
