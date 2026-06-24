/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Ticker-admin data hook: lists all ticker messages and exposes create / update /
 * delete. All fetching lives here; the page stays presentational.
 */
import { useCallback, useEffect, useState } from "react";
import { TICKER_SPEED_DEFAULT, type TickerMessageDTO, type TickerSeverity } from "@argus/shared";
import { api } from "@/lib/api";

interface ListResponse<T> {
  rows: T[];
}

/** Mutable fields of a ticker message (server fills id/createdAt). */
export interface TickerInput {
  text: string;
  severity: TickerSeverity;
  priority: number;
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  deviceGroupIds: string[];
  userGroupIds: string[];
}

interface UseTicker {
  loading: boolean;
  error: string | null;
  messages: TickerMessageDTO[];
  speed: number;
  reload: () => void;
  create: (input: TickerInput) => Promise<void>;
  update: (id: string, input: Partial<TickerInput>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  saveSpeed: (px: number) => Promise<void>;
}

export function useTicker(): UseTicker {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<TickerMessageDTO[]>([]);
  const [speed, setSpeed] = useState<number>(TICKER_SPEED_DEFAULT);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, cfg] = await Promise.all([
        api.get<ListResponse<TickerMessageDTO>>("/api/ticker"),
        api.get<{ speed: number }>("/api/ticker/config"),
      ]);
      setMessages(list.rows);
      setSpeed(cfg.speed);
    } catch {
      setError("Failed to load ticker messages.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: TickerInput) => {
      await api.post("/api/ticker", input);
      await load();
    },
    [load],
  );

  const update = useCallback(
    async (id: string, input: Partial<TickerInput>) => {
      await api.patch(`/api/ticker/${id}`, input);
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.del(`/api/ticker/${id}`);
      await load();
    },
    [load],
  );

  const saveSpeed = useCallback(async (px: number) => {
    const res = await api.put<{ speed: number }>("/api/ticker/config", { speed: px });
    setSpeed(res.speed);
  }, []);

  return { loading, error, messages, speed, reload: () => void load(), create, update, remove, saveSpeed };
}
