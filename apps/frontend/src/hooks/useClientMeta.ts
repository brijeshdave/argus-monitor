/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Client metadata hook: loads per-IP custom name + description and exposes a save,
 * returned as an ip→meta lookup so the connected-client table can apply overrides.
 */
import { useCallback, useEffect, useState } from "react";
import type { ClientMetaDTO, ClientMetaInput } from "@argus/shared";
import { api } from "@/lib/api";

export function useClientMeta() {
  const [byIp, setByIp] = useState<Map<string, ClientMetaDTO>>(new Map());

  const reload = useCallback(async () => {
    try {
      const res = await api.get<{ rows: ClientMetaDTO[] }>("/api/client-meta");
      setByIp(new Map(res.rows.map((r) => [r.ip, r])));
    } catch {
      /* annotations are optional — ignore load failures */
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (ip: string, input: ClientMetaInput) => {
    await api.put(`/api/client-meta/${encodeURIComponent(ip)}`, input);
    await reload();
  }, [reload]);

  return { byIp, save, reload };
}
