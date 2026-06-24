/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Agent-builds data hook: lists built installers (one per version+platform), reports
 * the current agent version + whether the server has a Go toolchain, triggers a
 * cross-compile (one target or the whole matrix), and downloads a specific build as
 * an authenticated blob → browser save. All fetching lives here.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getAccess } from "@/lib/tokens";

/** Selectable build targets (mirrors the backend allowlists). */
export type AgentOS = "windows" | "linux" | "darwin";
export type AgentArch = "amd64" | "arm64";

/** One built installer (a version+platform folder holding argus-monitor[.exe]). */
export interface BuildMeta {
  version: string;
  os: string;
  arch: string;
  size: number;
  builtAt: string;
  /** For os="nas": image archive format ("qnap" | "docker"). */
  format?: string;
}

interface ListResponse {
  rows: BuildMeta[];
  goAvailable: boolean;
  currentVersion: string;
}

interface UseAgentBuilds {
  loading: boolean;
  error: string | null;
  builds: BuildMeta[];
  goAvailable: boolean;
  currentVersion: string;
  reload: () => void;
  build: (os: AgentOS, arch: AgentArch) => Promise<void>;
  buildAll: () => Promise<BuildAllResult>;
  buildNas: (arch: AgentArch, format: NasFormat) => Promise<void>;
  download: (b: { version: string; os: string; arch: string }) => Promise<void>;
  downloadNasImage: (arch: AgentArch, format: NasFormat) => Promise<void>;
}

/** NAS image archive formats. */
export type NasFormat = "qnap" | "docker";

/** Result of a "build all platforms" run. */
export interface BuildAllResult {
  version: string;
  built: string[];
  failed: Array<{ target: string; error: string }>;
}

export function useAgentBuilds(): UseAgentBuilds {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [builds, setBuilds] = useState<BuildMeta[]>([]);
  const [goAvailable, setGoAvailable] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ListResponse>("/api/agent-builds");
      setBuilds(res.rows);
      setGoAvailable(res.goAvailable);
      setCurrentVersion(res.currentVersion);
    } catch {
      setError("Failed to load agent installers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const build = useCallback(
    async (os: AgentOS, arch: AgentArch) => {
      await api.post("/api/agent-builds", { os, arch });
      await load();
    },
    [load],
  );

  const buildAll = useCallback(async () => {
    const res = await api.post<BuildAllResult>("/api/agent-builds", { all: true });
    await load();
    return res;
  }, [load]);

  const buildNas = useCallback(
    async (arch: AgentArch, format: NasFormat) => {
      await api.post("/api/agent-builds", { nas: true, arch, format });
      await load();
    },
    [load],
  );

  const download = useCallback(async (b: { version: string; os: string; arch: string }) => {
    // Authenticated blob → browser save (mirrors the backups download pattern).
    const headers: Record<string, string> = {};
    const token = getAccess();
    if (token) headers.Authorization = `Bearer ${token}`;
    const qs = new URLSearchParams({ version: b.version, os: b.os, arch: b.arch }).toString();
    const raw = await fetch(`/api/agent-builds/download?${qs}`, { headers });
    if (!raw.ok) throw new Error("download failed");
    const blob = await raw.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `argus-monitor-${b.os}-${b.arch}-${b.version}${b.os === "windows" ? ".exe" : ""}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const downloadNasImage = useCallback(async (arch: AgentArch, format: NasFormat) => {
    const headers: Record<string, string> = {};
    const token = getAccess();
    if (token) headers.Authorization = `Bearer ${token}`;
    const raw = await fetch(`/api/agent-builds/nas-image?arch=${arch}&format=${format}`, { headers });
    if (!raw.ok) throw new Error("download failed");
    const blob = await raw.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `argus-agent-${format}-latest${arch === "amd64" ? "" : `-${arch}`}.tar`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  return {
    loading,
    error,
    builds,
    goAvailable,
    currentVersion,
    reload: () => void load(),
    build,
    buildAll,
    buildNas,
    download,
    downloadNasImage,
  };
}
