/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Self-service profile data hook: exposes the caller's active sessions plus the
 * profile, password-change and session-revoke writes. All fetching lives here so
 * ProfilePage stays presentational.
 */
import { useCallback, useEffect, useState } from "react";
import type { SessionDTO } from "@argus/shared";
import { api } from "@/lib/api";
import { getRefresh, setTokens } from "@/lib/tokens";

interface ListResponse<T> {
  rows: T[];
}

export interface ProfilePatch {
  displayName?: string;
  email?: string | null;
}

interface UseProfile {
  loading: boolean;
  error: string | null;
  sessions: SessionDTO[];
  reload: () => void;
  updateProfile: (patch: ProfilePatch) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  revokeSession: (id: string) => Promise<void>;
}

export function useProfile(): UseProfile {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionDTO[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ListResponse<SessionDTO>>("/api/me/sessions");
      setSessions(res.rows);
    } catch {
      setError("Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateProfile = useCallback(async (patch: ProfilePatch) => {
    await api.patch("/api/me/profile", patch);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    // The backend keeps THIS session alive and returns a fresh access token (it
    // bumped the token version, killing the old one). Store it so we stay signed in.
    const res = await api.post<{ ok: boolean; accessToken?: string }>("/api/me/password", { currentPassword, newPassword });
    const refresh = getRefresh();
    if (res.accessToken && refresh) setTokens(res.accessToken, refresh);
    await load();
  }, [load]);

  const revokeSession = useCallback(
    async (id: string) => {
      await api.del(`/api/me/sessions/${id}`);
      await load();
    },
    [load],
  );

  return {
    loading,
    error,
    sessions,
    reload: () => void load(),
    updateProfile,
    changePassword,
    revokeSession,
  };
}
