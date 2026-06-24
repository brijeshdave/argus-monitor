/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Backups data hook: lists backup files, runs an on-demand backup of a scope,
 * deletes/prunes copies, restores a bundle (DESTRUCTIVE), downloads a bundle
 * (authenticated blob → browser save), and loads/saves the schedule LIST + the
 * global retention policy. All fetching lives here.
 */
import { useCallback, useEffect, useState } from "react";
import type { BackupMeta, BackupRetention, BackupSchedule, BackupScope } from "@argus/shared";
import { api } from "@/lib/api";
import { getAccess } from "@/lib/tokens";

export type { BackupMeta, BackupSchedule, BackupRetention } from "@argus/shared";

interface UseBackups {
  loading: boolean;
  error: string | null;
  backups: BackupMeta[];
  schedules: BackupSchedule[];
  retention: BackupRetention | null;
  reload: () => void;
  runBackup: (scope: BackupScope) => Promise<void>;
  restore: (name: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  prune: () => Promise<number>;
  download: (name: string) => Promise<void>;
  saveSchedules: (schedules: BackupSchedule[]) => Promise<void>;
  saveRetention: (retention: BackupRetention) => Promise<void>;
}

export function useBackups(): UseBackups {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
  const [retention, setRetention] = useState<BackupRetention | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, sched, ret] = await Promise.all([
        api.get<{ rows: BackupMeta[] }>("/api/backups"),
        api.get<{ schedules: BackupSchedule[] }>("/api/backups/schedules"),
        api.get<{ retention: BackupRetention }>("/api/backups/retention"),
      ]);
      setBackups(list.rows);
      setSchedules(sched.schedules);
      setRetention(ret.retention);
    } catch {
      setError("Failed to load backups.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runBackup = useCallback(async (scope: BackupScope) => {
    await api.post("/api/backups", { scope });
    await load();
  }, [load]);

  const restore = useCallback(async (name: string) => {
    await api.post(`/api/backups/${encodeURIComponent(name)}/restore`);
    await load();
  }, [load]);

  const remove = useCallback(async (name: string) => {
    await api.del(`/api/backups/${encodeURIComponent(name)}`);
    await load();
  }, [load]);

  const prune = useCallback(async () => {
    const res = await api.post<{ deleted: string[] }>("/api/backups/prune", {});
    await load();
    return res.deleted.length;
  }, [load]);

  const download = useCallback(async (name: string) => {
    // The download endpoint needs a bearer header, so fetch as a blob (the shared
    // api client parses JSON bodies) and trigger a browser save from an object URL.
    const headers: Record<string, string> = {};
    const token = getAccess();
    if (token) headers.Authorization = `Bearer ${token}`;
    const raw = await fetch(`/api/backups/${encodeURIComponent(name)}/download`, { headers });
    if (!raw.ok) throw new Error("download failed");
    const blob = await raw.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const saveSchedules = useCallback(async (next: BackupSchedule[]) => {
    const res = await api.put<{ schedules: BackupSchedule[] }>("/api/backups/schedules", { schedules: next });
    setSchedules(res.schedules);
  }, []);

  const saveRetention = useCallback(async (next: BackupRetention) => {
    const res = await api.put<{ retention: BackupRetention }>("/api/backups/retention", next);
    setRetention(res.retention);
  }, []);

  return {
    loading,
    error,
    backups,
    schedules,
    retention,
    reload: () => void load(),
    runBackup,
    restore,
    remove,
    prune,
    download,
    saveSchedules,
    saveRetention,
  };
}
