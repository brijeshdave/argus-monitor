/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Settings page data hook: fetches the settings map and exposes a save action
 * (PUT /api/settings/:key). All fetching lives here.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface SettingsResponse {
  settings: Record<string, unknown>;
}

interface UseSettings {
  loading: boolean;
  error: string | null;
  settings: Record<string, unknown>;
  reload: () => void;
  save: (key: string, value: unknown) => Promise<void>;
}

export function useSettings(): UseSettings {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<SettingsResponse>("/api/settings");
      setSettings(res.settings);
    } catch {
      setError("Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (key: string, value: unknown) => {
      await api.put(`/api/settings/${encodeURIComponent(key)}`, { value });
      await load();
    },
    [load],
  );

  return { loading, error, settings, reload: () => void load(), save };
}
