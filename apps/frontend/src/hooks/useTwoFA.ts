/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Self-service two-factor (TOTP) data hook: exposes the caller's 2FA status plus
 * the setup / enable / disable writes. All fetching lives here so ProfilePage
 * stays presentational. Secrets and recovery codes are held only transiently in
 * the caller's component state and never persisted client-side.
 */
import { useCallback, useEffect, useState } from "react";
import type { TwoFAEnableResponse, TwoFASetupResponse, TwoFAStatus } from "@argus/shared";
import { api } from "@/lib/api";

interface UseTwoFA {
  loading: boolean;
  status: TwoFAStatus | null;
  reload: () => void;
  setup: () => Promise<TwoFASetupResponse>;
  enable: (code: string) => Promise<string[]>;
  disable: (code: string) => Promise<void>;
}

export function useTwoFA(): UseTwoFA {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TwoFAStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await api.get<TwoFAStatus>("/api/me/2fa"));
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setup = useCallback(() => api.post<TwoFASetupResponse>("/api/me/2fa/setup"), []);

  const enable = useCallback(
    async (code: string) => {
      const res = await api.post<TwoFAEnableResponse>("/api/me/2fa/enable", { code });
      await load();
      return res.recoveryCodes;
    },
    [load],
  );

  const disable = useCallback(
    async (code: string) => {
      await api.post("/api/me/2fa/disable", { code });
      await load();
    },
    [load],
  );

  return { loading, status, reload: () => void load(), setup, enable, disable };
}
