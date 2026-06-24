/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Wallboard-devices data hook: lists registered display devices and exposes the
 * management lifecycle actions (approve → one-time token, revoke, assign layout,
 * delete). All fetching lives here; the page stays presentational.
 */
import { useCallback, useEffect, useState } from "react";
import type { WallDeviceDTO, WallDeviceGroupDTO, WallLayoutDTO } from "@argus/shared";
import { api } from "@/lib/api";

interface ListResponse<T> {
  rows: T[];
}

interface UseDevices {
  loading: boolean;
  error: string | null;
  devices: WallDeviceDTO[];
  layouts: WallLayoutDTO[];
  deviceGroups: WallDeviceGroupDTO[];
  reload: () => void;
  create: (name: string) => Promise<void>;
  revoke: (id: string) => Promise<void>;
  assignLayout: (id: string, layoutId: string | null) => Promise<void>;
  assignGroup: (id: string, groupId: string | null) => Promise<void>;
  createGroup: (name: string) => Promise<void>;
  updateGroup: (id: string, patch: { name?: string; layoutId?: string | null }) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useDevices(): UseDevices {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<WallDeviceDTO[]>([]);
  const [layouts, setLayouts] = useState<WallLayoutDTO[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<WallDeviceGroupDTO[]>([]);

  // `silent` (used by the poll) refreshes online status without flashing the spinner.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [d, w, g] = await Promise.all([
        api.get<ListResponse<WallDeviceDTO>>("/api/devices"),
        api.get<ListResponse<WallLayoutDTO>>("/api/wallboards"),
        api.get<ListResponse<WallDeviceGroupDTO>>("/api/device-groups"),
      ]);
      setDevices(d.rows);
      setLayouts(w.rows);
      setDeviceGroups(g.rows);
    } catch {
      setError("Failed to load devices.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Poll so the live/offline status reflects reality without a manual refresh.
    const t = setInterval(() => void load(true), 10_000);
    return () => clearInterval(t);
  }, [load]);

  const create = useCallback(
    async (name: string) => {
      await api.post("/api/devices", { name });
      await load();
    },
    [load],
  );

  const revoke = useCallback(
    async (id: string) => {
      await api.post(`/api/devices/${id}/revoke`);
      await load();
    },
    [load],
  );

  const assignLayout = useCallback(
    async (id: string, layoutId: string | null) => {
      await api.patch(`/api/devices/${id}/layout`, { layoutId });
      await load();
    },
    [load],
  );

  const assignGroup = useCallback(
    async (id: string, groupId: string | null) => {
      await api.patch(`/api/devices/${id}/group`, { groupId });
      await load();
    },
    [load],
  );

  const createGroup = useCallback(
    async (name: string) => {
      await api.post("/api/device-groups", { name });
      await load();
    },
    [load],
  );

  const updateGroup = useCallback(
    async (id: string, patch: { name?: string; layoutId?: string | null }) => {
      await api.patch(`/api/device-groups/${id}`, patch);
      await load();
    },
    [load],
  );

  const deleteGroup = useCallback(
    async (id: string) => {
      await api.del(`/api/device-groups/${id}`);
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.del(`/api/devices/${id}`);
      await load();
    },
    [load],
  );

  return {
    loading,
    error,
    devices,
    layouts,
    deviceGroups,
    reload: () => void load(),
    create,
    revoke,
    assignLayout,
    assignGroup,
    createGroup,
    updateGroup,
    deleteGroup,
    remove,
  };
}
