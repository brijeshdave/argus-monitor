/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * SNMP profiles ("MIB master") data hook: list + create / update / delete. System
 * profiles are read-only (enforced server-side). All fetching lives here.
 */
import { useCallback, useEffect, useState } from "react";
import type { SnmpProfileDTO, SnmpProfileInput } from "@argus/shared";
import { api } from "@/lib/api";

interface UseSnmpProfiles {
  loading: boolean;
  error: string | null;
  profiles: SnmpProfileDTO[];
  reload: () => void;
  create: (input: SnmpProfileInput) => Promise<void>;
  update: (id: string, input: SnmpProfileInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useSnmpProfiles(): UseSnmpProfiles {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<SnmpProfileDTO[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ rows: SnmpProfileDTO[] }>("/api/snmp-profiles");
      setProfiles(res.rows);
    } catch {
      setError("Failed to load SNMP profiles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async (input: SnmpProfileInput) => { await api.post("/api/snmp-profiles", input); await load(); }, [load]);
  const update = useCallback(async (id: string, input: SnmpProfileInput) => { await api.patch(`/api/snmp-profiles/${id}`, input); await load(); }, [load]);
  const remove = useCallback(async (id: string) => { await api.del(`/api/snmp-profiles/${id}`); await load(); }, [load]);

  return { loading, error, profiles, reload: () => void load(), create, update, remove };
}
