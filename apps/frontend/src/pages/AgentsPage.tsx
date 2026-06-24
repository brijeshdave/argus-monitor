/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Agents admin, organised into three tabs:
 *   • Agents          — the fleet table (approve/revoke/update), sortable, filtered
 *                       by platform/status/connection, and paginated. Add-device form.
 *   • Agent installers — build + download the agent for each platform (sortable,
 *                       paginated artifacts table).
 *   • Connection keys  — mint + revoke connection keys (sortable, paginated).
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAgents, type MintedKey } from "@/hooks/useAgents";
import {
  useAgentBuilds,
  type AgentArch,
  type AgentOS,
  type NasFormat,
} from "@/hooks/useAgentBuilds";
import { useAuth } from "@/auth/AuthContext";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLiveState } from "@/hooks/useLiveState";
import { useClientPager } from "@/hooks/useClientPager";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { SortHeader, useSort } from "@/components/SortHeader";
import { FilterDrawer } from "@/components/FilterDrawer";
import { Pager } from "@/components/Pager";
import { Tabs } from "@/components/Tabs";

type AgentSortKey = "name" | "hostname" | "platform" | "version" | "connection" | "status" | "lastSeenAt";
type KeySortKey = "label" | "status" | "lastUsedAt" | "createdAt";
type BuildSortKey = "artifact" | "version" | "size" | "builtAt";

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Human-readable byte size for the installer table. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

const inputCls = "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";
const fieldCls = "mb-1 block text-xs uppercase tracking-wide text-slate-500";

export function AgentsPage() {
  const { has } = useAuth();
  const confirm = useConfirm();
  const { loading, error, agents, keys, approve, revoke, update, mintKey, revokeKey, createDevice } = useAgents();
  const {
    error: buildsError,
    builds,
    goAvailable,
    currentVersion,
    build,
    buildAll,
    buildNas,
    download,
    downloadNasImage,
  } = useAgentBuilds();

  // Live connectivity overlay (the REST list is the load-time baseline).
  const { agents: liveAgents } = useLiveState();
  const onlineById = useMemo(() => new Map(liveAgents.map((a) => [a.id, a.online])), [liveAgents]);

  const canApprove = has("agents:approve");
  const canWrite = has("agents:write");

  const [label, setLabel] = useState("");
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<MintedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  // Add-device form state (agentless NAS/switch/UPS target).
  const [deviceName, setDeviceName] = useState("");
  const [deviceAddr, setDeviceAddr] = useState("");
  const [addingDevice, setAddingDevice] = useState(false);

  // ── Agents tab: filters + sort + pagination ──────────────────────────────
  const [fPlatform, setFPlatform] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fConn, setFConn] = useState("");
  const platformOptions = useMemo(
    () => Array.from(new Set(agents.map((a) => a.platform).filter((p): p is string => !!p))).sort(),
    [agents],
  );
  const { sorted: sortedAgents, sort: agentSort } = useSort<(typeof agents)[number], AgentSortKey>(
    agents,
    (a, key) => (key === "connection" ? (onlineById.get(a.id) ?? a.online) : a[key]),
    { key: "name" },
  );
  const filteredAgents = useMemo(
    () =>
      sortedAgents.filter((a) => {
        if (fPlatform && a.platform !== fPlatform) return false;
        if (fStatus && a.status !== fStatus) return false;
        if (fConn) {
          const online = onlineById.get(a.id) ?? a.online;
          if (fConn === "agentless" && a.kind !== "device") return false;
          if (fConn === "online" && (a.kind === "device" || !online)) return false;
          if (fConn === "offline" && (a.kind === "device" || online)) return false;
        }
        return true;
      }),
    [sortedAgents, fPlatform, fStatus, fConn, onlineById],
  );
  const agentFilterCount = (fPlatform ? 1 : 0) + (fStatus ? 1 : 0) + (fConn ? 1 : 0);
  const agentPager = useClientPager(filteredAgents, 25);

  // ── Connection keys tab: sort + filter + pagination ──────────────────────
  const [fKeyStatus, setFKeyStatus] = useState("");
  const { sorted: sortedKeys, sort: keySort } = useSort<(typeof keys)[number], KeySortKey>(
    keys,
    (k, key) => (key === "status" ? (k.disabled ? "revoked" : "active") : k[key as keyof typeof k]),
    { key: "createdAt", dir: "desc" },
  );
  const filteredKeys = useMemo(
    () => sortedKeys.filter((k) => (fKeyStatus ? (fKeyStatus === "revoked" ? k.disabled : !k.disabled) : true)),
    [sortedKeys, fKeyStatus],
  );
  const keyPager = useClientPager(filteredKeys, 25);

  // ── Installers tab: sort + filter + pagination ───────────────────────────
  const [fBuildOs, setFBuildOs] = useState("");
  const { sorted: sortedBuilds, sort: buildSort } = useSort<(typeof builds)[number], BuildSortKey>(
    builds,
    (b, key) => (key === "artifact" ? `${b.os}-${b.arch}` : b[key === "builtAt" ? "builtAt" : (key as "version" | "size")]),
    { key: "builtAt", dir: "desc" },
  );
  const filteredBuilds = useMemo(
    () => sortedBuilds.filter((b) => (fBuildOs ? b.os === fBuildOs : true)),
    [sortedBuilds, fBuildOs],
  );
  const buildOsOptions = useMemo(() => Array.from(new Set(builds.map((b) => b.os))).sort(), [builds]);
  const buildPager = useClientPager(filteredBuilds, 25);

  // Build-form state. "nas" is a pseudo-OS that builds a container image (format-selectable).
  const [buildOs, setBuildOs] = useState<AgentOS | "nas">("linux");
  const [buildArch, setBuildArch] = useState<AgentArch>("amd64");
  const [buildFormat, setBuildFormat] = useState<NasFormat>("qnap");
  const [building, setBuilding] = useState(false);

  // Download selector state (platform + version dropdowns, derived from builds).
  const [dlPlatform, setDlPlatform] = useState("");
  const [dlVersion, setDlVersion] = useState("");
  const platforms = useMemo(
    () => Array.from(new Set(builds.filter((b) => b.os !== "nas").map((b) => `${b.os}-${b.arch}`))).sort(),
    [builds],
  );
  const versionsForPlatform = useMemo(() => {
    const [os, arch] = dlPlatform.split("-");
    return builds.filter((b) => b.os === os && b.arch === arch).map((b) => b.version);
  }, [builds, dlPlatform]);
  useEffect(() => {
    if (platforms.length && !platforms.includes(dlPlatform)) setDlPlatform(platforms[0] ?? "");
  }, [platforms, dlPlatform]);
  useEffect(() => {
    if (versionsForPlatform.length && !versionsForPlatform.includes(dlVersion)) setDlVersion(versionsForPlatform[0] ?? "");
  }, [versionsForPlatform, dlVersion]);

  async function onAddDevice(e: FormEvent) {
    e.preventDefault();
    if (!deviceName.trim()) return;
    setAddingDevice(true);
    setActionError(null);
    try {
      await createDevice(deviceName.trim(), deviceAddr.trim() || undefined);
      setActionNote(`Device "${deviceName.trim()}" added. Add SNMP/ping monitors to it.`);
      setDeviceName("");
      setDeviceAddr("");
    } catch {
      setActionError("Failed to add device.");
    } finally {
      setAddingDevice(false);
    }
  }

  async function onBuildAll() {
    setBuilding(true);
    setActionError(null);
    setActionNote(null);
    try {
      const r = await buildAll();
      const ok = r.built.length;
      const failedMsg = r.failed.length ? ` · ${r.failed.length} failed: ${r.failed.map((f) => f.target).join(", ")}` : "";
      setActionNote(`v${r.version}: ${ok === 0 ? "all targets already built" : `built ${ok} target${ok === 1 ? "" : "s"} (${r.built.join(", ")})`}${failedMsg}`);
      if (r.failed.length) setActionError(`Some builds failed: ${r.failed.map((f) => `${f.target} — ${f.error}`).join("; ")}`);
    } catch {
      setActionError("Failed to build installers.");
    } finally {
      setBuilding(false);
    }
  }

  async function onMint(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setMinting(true);
    setActionError(null);
    try {
      const res = await mintKey(label.trim());
      setMinted(res);
      setLabel("");
      setCopied(false);
    } catch {
      setActionError("Failed to mint connection key.");
    } finally {
      setMinting(false);
    }
  }

  async function runAction(fn: () => Promise<void>) {
    setActionError(null);
    try {
      await fn();
    } catch {
      setActionError("Action failed. Please try again.");
    }
  }

  async function onUpdate(id: string, name: string) {
    const ok = await confirm({
      title: "Update agent",
      message: `Update "${name}" to the latest built version? The agent downloads the new binary and restarts itself.`,
      confirmLabel: "Update",
      danger: false,
    });
    if (!ok) return;
    setActionError(null);
    setActionNote(null);
    try {
      await update(id);
      setActionNote("Update queued.");
    } catch {
      setActionError("Failed to queue update.");
    }
  }

  async function onRevoke(id: string, name: string) {
    const ok = await confirm({
      title: "Revoke agent",
      message: `Revoke "${name}"? It will immediately lose the ability to send telemetry until re-approved.`,
      confirmLabel: "Revoke",
    });
    if (ok) await runAction(() => revoke(id));
  }

  async function onRevokeKey(id: string, lbl: string) {
    const ok = await confirm({
      title: "Revoke connection key",
      message: `Revoke connection key "${lbl}"? Any agent still using it will be disconnected.`,
      confirmLabel: "Revoke",
    });
    if (ok) await runAction(() => revokeKey(id));
  }

  async function onBuild(e: FormEvent) {
    e.preventDefault();
    setBuilding(true);
    setActionError(null);
    setActionNote(null);
    try {
      if (buildOs === "nas") {
        await buildNas(buildArch, buildFormat);
        setActionNote(`Built NAS image (${buildFormat}, linux/${buildArch}) v${currentVersion} — download it from the table below.`);
      } else {
        await build(buildOs, buildArch);
        setActionNote(`Built argus-agent-${buildOs}-${buildArch}.`);
      }
    } catch {
      setActionError(buildOs === "nas" ? "Failed to build NAS image." : "Failed to build agent installer.");
    } finally {
      setBuilding(false);
    }
  }

  async function copyKey() {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (loading) return <Spinner label="Loading agents…" />;

  // ── Tab: Agents ──────────────────────────────────────────────────────────
  const agentsNode = (
    <div className="space-y-5">
      {canWrite ? (
        <form onSubmit={onAddDevice} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="min-w-[12rem]">
            <label htmlFor="deviceName" className={fieldCls}>Add device — name</label>
            <input id="deviceName" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="NAS-KOS-01" className={inputCls} />
          </div>
          <div className="min-w-[10rem]">
            <label htmlFor="deviceAddr" className={fieldCls}>Host / IP (optional)</label>
            <input id="deviceAddr" value={deviceAddr} onChange={(e) => setDeviceAddr(e.target.value)} placeholder="10.2.0.31" className={inputCls} />
          </div>
          <button type="submit" disabled={addingDevice || !deviceName.trim()} className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">
            {addingDevice ? "Adding…" : "Add device"}
          </button>
          <span className="self-center text-xs text-slate-500">An agentless target (NAS, switch, UPS) — then add SNMP/ping monitors to it.</span>
        </form>
      ) : null}

      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">{filteredAgents.length} of {agents.length} agent{agents.length === 1 ? "" : "s"}</span>
        <FilterDrawer appliedCount={agentFilterCount} onReset={() => { setFPlatform(""); setFStatus(""); setFConn(""); }}>
          <label className="block">
            <span className={fieldCls}>Platform</span>
            <select value={fPlatform} onChange={(e) => setFPlatform(e.target.value)} className={inputCls}>
              <option value="">All platforms</option>
              {platformOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={fieldCls}>Approval status</span>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inputCls}>
              <option value="">Any status</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="revoked">Revoked</option>
            </select>
          </label>
          <label className="block">
            <span className={fieldCls}>Connection</span>
            <select value={fConn} onChange={(e) => setFConn(e.target.value)} className={inputCls}>
              <option value="">Any</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="agentless">Agentless device</option>
            </select>
          </label>
        </FilterDrawer>
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortHeader label="Name" sortKey="name" sort={agentSort} />
              <SortHeader label="Hostname" sortKey="hostname" sort={agentSort} />
              <SortHeader label="Platform" sortKey="platform" sort={agentSort} />
              <SortHeader label="Version" sortKey="version" sort={agentSort} />
              <SortHeader label="Connection" sortKey="connection" sort={agentSort} />
              <SortHeader label="Status" sortKey="status" sort={agentSort} />
              <SortHeader label="Last seen" sortKey="lastSeenAt" sort={agentSort} />
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filteredAgents.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-6 text-slate-500">{agents.length === 0 ? "No agents registered yet." : "No agents match the filters."}</td></tr>
            ) : (
              agentPager.pageRows.map((a) => {
                const online = onlineById.get(a.id) ?? a.online;
                return (
                  <tr key={a.id} className="text-slate-200">
                    <td className="px-4 py-3">
                      <Link to={`/agents/${a.id}`} className="text-sky-300 transition-colors hover:text-sky-200">{a.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{a.hostname ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-400">{a.platform ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{a.version ?? "—"}</td>
                    <td className="px-4 py-3">
                      {a.kind === "device" ? (
                        <span className="inline-flex items-center gap-1.5 text-slate-400" title="Agentless device — health comes from its monitors, not a control socket">
                          <span className="h-2 w-2 rounded-full bg-sky-400/70" aria-hidden />
                          Agentless
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/70" : "bg-slate-600"}`} aria-hidden />
                          <span className={online ? "text-emerald-300" : "text-slate-500"}>{online ? "Online" : "Offline"}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-3 text-slate-400">{formatWhen(a.lastSeenAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {canApprove && a.status !== "approved" ? (
                          <button type="button" onClick={() => runAction(() => approve(a.id))} className="rounded-md border border-emerald-600/50 px-2.5 py-1 text-xs text-emerald-300 transition-colors hover:bg-emerald-500/10">Approve</button>
                        ) : null}
                        {canWrite && a.status === "approved" && a.kind !== "device" ? (
                          <button type="button" onClick={() => onUpdate(a.id, a.name)} className="rounded-md border border-sky-600/50 px-2.5 py-1 text-xs text-sky-300 transition-colors hover:bg-sky-500/10">Update</button>
                        ) : null}
                        {canWrite && a.status !== "revoked" ? (
                          <button type="button" onClick={() => onRevoke(a.id, a.name)} className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 transition-colors hover:bg-rose-500/10">Revoke</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {filteredAgents.length > agentPager.list.limit ? <Pager list={agentPager.list} /> : null}
      </section>
    </div>
  );

  // ── Tab: Agent installers ────────────────────────────────────────────────
  const installersNode = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs text-slate-500">Current agent version: <span className="font-mono text-slate-300">{currentVersion || "—"}</span></span>
      </div>

      {buildsError ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{buildsError}</div> : null}

      {/* Download: pick platform + version */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="min-w-[12rem]">
          <label htmlFor="dlPlatform" className={fieldCls}>Platform</label>
          <select id="dlPlatform" value={dlPlatform} onChange={(e) => setDlPlatform(e.target.value)} className={inputCls}>
            {platforms.length === 0 ? <option value="">No builds yet</option> : null}
            {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="min-w-[12rem]">
          <label htmlFor="dlVersion" className={fieldCls}>Version</label>
          <select id="dlVersion" value={dlVersion} onChange={(e) => setDlVersion(e.target.value)} className={inputCls}>
            {versionsForPlatform.length === 0 ? <option value="">—</option> : null}
            {versionsForPlatform.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <button type="button" disabled={!dlPlatform || !dlVersion} onClick={() => {
          const [os, arch] = dlPlatform.split("-");
          if (!os || !arch || !dlVersion) return;
          void runAction(() => download({ version: dlVersion, os, arch }));
        }} className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">Download</button>
        <span className="self-center text-xs text-slate-500">{builds.length} build{builds.length === 1 ? "" : "s"} available</span>
      </div>

      {/* Build (operators) */}
      {canWrite ? (
        goAvailable ? (
          <form onSubmit={onBuild} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div className="min-w-[12rem]">
              <label htmlFor="buildOs" className={fieldCls}>Build — OS</label>
              <select id="buildOs" value={buildOs} onChange={(e) => setBuildOs(e.target.value as AgentOS | "nas")} className={inputCls}>
                <option value="windows">Windows</option>
                <option value="linux">Linux</option>
                <option value="darwin">macOS</option>
                <option value="nas">NAS / Container image</option>
              </select>
            </div>
            <div className="min-w-[8rem]">
              <label htmlFor="buildArch" className={fieldCls}>Architecture</label>
              <select id="buildArch" value={buildArch} onChange={(e) => setBuildArch(e.target.value as AgentArch)} className={inputCls}>
                <option value="amd64">amd64</option>
                <option value="arm64">arm64</option>
              </select>
            </div>
            {buildOs === "nas" ? (
              <div className="min-w-[12rem]">
                <label htmlFor="buildFormat" className={fieldCls}>Image format</label>
                <select id="buildFormat" value={buildFormat} onChange={(e) => setBuildFormat(e.target.value as NasFormat)} className={inputCls}>
                  <option value="qnap">QNAP (QuTS hero / Container Station)</option>
                  <option value="docker">Docker (generic docker load)</option>
                </select>
              </div>
            ) : null}
            <button type="submit" disabled={building} className="rounded-md border border-slate-600 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60">{building ? "Building…" : `Build ${currentVersion}`}</button>
            <button type="button" onClick={() => void onBuildAll()} disabled={building} className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">{building ? "Building…" : "Build all platforms"}</button>
          </form>
        ) : (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            This server has no Go toolchain, so agents can&apos;t be built here. Run the build on a host with Go installed, or use a builder image.
          </div>
        )
      ) : null}

      {builds.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
            <span className="text-xs text-slate-500">{filteredBuilds.length} artifact{filteredBuilds.length === 1 ? "" : "s"}</span>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              OS
              <select value={fBuildOs} onChange={(e) => setFBuildOs(e.target.value)} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500">
                <option value="">All</option>
                {buildOsOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortHeader label="Artifact" sortKey="artifact" sort={buildSort} />
                <SortHeader label="Version" sortKey="version" sort={buildSort} />
                <SortHeader label="Size" sortKey="size" sort={buildSort} />
                <SortHeader label="Built" sortKey="builtAt" sort={buildSort} />
                <th className="px-4 py-2 font-medium text-right">Get</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {buildPager.pageRows.map((b) => {
                const isLatest = b.version === currentVersion;
                const lbl = b.os === "nas" ? `NAS image (${b.format ?? "?"}) · ${b.arch}` : `${b.os} · ${b.arch}`;
                return (
                  <tr key={`${b.os}-${b.arch}-${b.format ?? ""}-${b.version}`} className="text-slate-200">
                    <td className="px-4 py-2">{lbl}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {b.version}
                      {isLatest ? <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">latest</span> : null}
                    </td>
                    <td className="px-4 py-2 text-slate-400">{formatBytes(b.size)}</td>
                    <td className="px-4 py-2 text-slate-400">{formatWhen(b.builtAt)}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => {
                        if (b.os === "nas") void runAction(() => downloadNasImage(b.arch as AgentArch, (b.format as NasFormat) ?? "qnap"));
                        else void runAction(() => download({ version: b.version, os: b.os, arch: b.arch }));
                      }} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500">Download</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredBuilds.length > buildPager.list.limit ? <Pager list={buildPager.list} /> : null}
        </section>
      ) : null}

      {goAvailable ? (
        <p className="text-xs text-slate-500">
          <span className="text-slate-300">NAS / Container image:</span> choose <span className="font-mono">OS = NAS / Container image</span>,
          pick an arch + format (<span className="font-mono">QNAP</span> for QuTS hero / Container Station Import, or <span className="font-mono">Docker</span> for
          <span className="font-mono"> docker load</span>), then Build. Download it from the table and import it on the NAS.
        </p>
      ) : null}
    </div>
  );

  // ── Tab: Connection keys ─────────────────────────────────────────────────
  const keysNode = (
    <div className="space-y-4">
      {canWrite ? (
        <form onSubmit={onMint} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor="keyLabel" className={fieldCls}>Label</label>
            <input id="keyLabel" type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. db-prod-01" className={inputCls} />
          </div>
          <button type="submit" disabled={minting || !label.trim()} className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">{minting ? "Minting…" : "Mint key"}</button>
        </form>
      ) : null}

      {minted ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="text-sm font-medium text-amber-200">Copy this key now — it is shown only once.</div>
          <div className="mt-2 flex items-center gap-3">
            <code className="flex-1 break-all rounded-md bg-slate-950 px-3 py-2 text-xs text-amber-100">{minted.key}</code>
            <button type="button" onClick={copyKey} className="rounded-md border border-amber-500/50 px-3 py-2 text-xs text-amber-200 transition-colors hover:bg-amber-500/10">{copied ? "Copied" : "Copy"}</button>
            <button type="button" onClick={() => setMinted(null)} className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 transition-colors hover:border-slate-500">Dismiss</button>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">{filteredKeys.length} of {keys.length} key{keys.length === 1 ? "" : "s"}</span>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Status
          <select value={fKeyStatus} onChange={(e) => setFKeyStatus(e.target.value)} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500">
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
          </select>
        </label>
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortHeader label="Label" sortKey="label" sort={keySort} />
              <SortHeader label="Status" sortKey="status" sort={keySort} />
              <SortHeader label="Last used" sortKey="lastUsedAt" sort={keySort} />
              <SortHeader label="Created" sortKey="createdAt" sort={keySort} />
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filteredKeys.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-slate-500">{keys.length === 0 ? "No connection keys yet." : "No keys match the filter."}</td></tr>
            ) : (
              keyPager.pageRows.map((k) => (
                <tr key={k.id} className="text-slate-200">
                  <td className="px-4 py-3">{k.label}</td>
                  <td className="px-4 py-3"><StatusBadge status={k.disabled ? "revoked" : "approved"} /></td>
                  <td className="px-4 py-3 text-slate-400">{formatWhen(k.lastUsedAt)}</td>
                  <td className="px-4 py-3 text-slate-400">{formatWhen(k.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      {canWrite && !k.disabled ? (
                        <button type="button" onClick={() => onRevokeKey(k.id, k.label)} className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 transition-colors hover:bg-rose-500/10">Revoke</button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {filteredKeys.length > keyPager.list.limit ? <Pager list={keyPager.list} /> : null}
      </section>
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-100">Agents</h1>

      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}
      {actionError ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{actionError}</div> : null}
      {actionNote ? <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{actionNote}</div> : null}

      <Tabs
        items={[
          { key: "agents", label: `Agents (${agents.length})`, node: agentsNode },
          { key: "installers", label: "Agent installers", node: installersNode },
          { key: "keys", label: `Connection keys (${keys.length})`, node: keysNode },
        ]}
      />
    </div>
  );
}
