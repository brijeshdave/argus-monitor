/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Admin session-management data hook: lists a single user's active sessions and
 * exposes terminate (single) + terminate-all writes. Used by the Users admin
 * "Sessions" modal. Fetching lives here; the modal stays presentational.
 */
import { useCallback, useEffect, useState } from "react";
import type { SessionDTO } from "@argus/shared";
import { api } from "@/lib/api";

interface ListResponse<T> {
  rows: T[];
}

interface UseUserSessions {
  loading: boolean;
  error: string | null;
  sessions: SessionDTO[];
  reload: () => void;
  terminate: (sessionId: string) => Promise<void>;
  terminateAll: () => Promise<void>;
}

export function useUserSessions(userId: string): UseUserSessions {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionDTO[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ListResponse<SessionDTO>>(`/api/users/${userId}/sessions`);
      setSessions(res.rows);
    } catch {
      setError("Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const terminate = useCallback(
    async (sessionId: string) => {
      await api.del(`/api/sessions/${sessionId}`);
      await load();
    },
    [load],
  );

  const terminateAll = useCallback(async () => {
    await api.post(`/api/users/${userId}/sessions/terminate`);
    await load();
  }, [userId, load]);

  return { loading, error, sessions, reload: () => void load(), terminate, terminateAll };
}
