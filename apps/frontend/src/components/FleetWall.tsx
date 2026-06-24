/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * FleetWall — the rich, fullscreen NOC wallboard. One
 * severity-sorted panel per host: status header + Net/Agent badges, an abnormality
 * alert strip, big live stats, per-component status-over-time bars, and live rolling
 * graphs (ping · clients · CPU/RAM) from a WS history buffer. Multiple fixed layouts
 * (flex / N-column / N-row / single-focus); panels fit the screen with no scrolling
 * and auto-rotate on the board's interval.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { Wifi, WifiOff, Radio, TriangleAlert, CircleCheck, HardDrive } from "lucide-react";
import type { AgentDTO, MonitorDTO, WallTemplate } from "@argus/shared";
import { useDashboard } from "@/hooks/useDashboard";
import { useLiveState } from "@/hooks/useLiveState";

export type { WallTemplate };

type Overall = "UP" | "DEGRADED" | "DOWN" | "UNKNOWN";
const OVERALL_COLOR: Record<Overall, string> = { UP: "var(--color-up)", DEGRADED: "var(--color-degraded)", DOWN: "var(--color-down)", UNKNOWN: "var(--color-unknown)" };
const RANK: Record<Overall, number> = { DOWN: 0, DEGRADED: 1, UNKNOWN: 2, UP: 3 };
const HIST = 60;

interface Comp { name: string; status: string; db?: { sessions?: number | null } }
interface Host {
  id: string; name: string; online: boolean; overall: Overall; isDevice: boolean;
  reachable: boolean | null; rtt: number | null;
  cpu: number | null; ram: number | null; clients: number; sessions: number; connections: number;
  rxBps: number | null; txBps: number | null; diskPct: number | null; diskFreeBytes: number | null; lastSeen: string | null;
  services: Comp[]; databases: Comp[];
  stores: { name: string; usedPct: number | null; freeBytes: number | null; status: string }[];
  snmpItems: { label: string; value: string; unit?: string | null }[];
  disks: { name: string; status?: string | null; tempC?: number | null }[];
}
interface Pt { t: number; cpu: number; ram: number; clients: number; sessions: number; rx: number; tx: number; disk: number; statuses: Record<string, number | null> }

const fmtBytes = (b: number): string => {
  const u = ["B", "KB", "MB", "GB", "TB", "PB"]; let i = 0; let n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};

const fmtBps = (bytesPerSec: number): string => {
  const v = bytesPerSec; const u = ["B/s", "KB/s", "MB/s", "GB/s"]; let i = 0; let n = v;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};

const statusScore = (st: string): number | null => (st === "UP" ? 1 : st === "HANG" || st === "DEGRADED" ? 0.5 : st === "DOWN" ? 0 : null);
const scoreColor = (v: number | null): string => (v == null ? "var(--color-unknown)" : v >= 1 ? "var(--color-up)" : v >= 0.5 ? "var(--color-hang)" : "var(--color-down)");
const wordColor = (st: string): string => scoreColor(statusScore(st));
function rollup(statuses: string[]): Overall {
  if (statuses.length === 0) return "UNKNOWN";
  if (statuses.includes("DOWN")) return "DOWN";
  if (statuses.some((s) => s === "DEGRADED" || s === "HANG")) return "DEGRADED";
  if (statuses.every((s) => s === "UP")) return "UP";
  return "UNKNOWN";
}

function Badge({ icon, text, color }: { icon: React.ReactNode; text: string; color: string }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: ".5cqmin", padding: ".4cqmin 1cqmin", borderRadius: "0.9cqmin", background: `${color}1f`, border: `1px solid ${color}66`, color, fontWeight: 700, fontSize: "clamp(10px,1.3cqmin,24px)", whiteSpace: "nowrap" }}>{icon}{text}</span>;
}
function BigStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ minWidth: "clamp(58px,9cqmin,150px)", flex: "0 1 auto" }}>
      <div style={{ color: "var(--color-text-muted)", fontSize: "clamp(8px,1.15cqmin,20px)", textTransform: "uppercase", letterSpacing: ".06em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div className="font-data" style={{ fontWeight: 700, fontSize: "clamp(18px,3.2cqmin,64px)", lineHeight: 1.05, color: tone ?? "var(--color-text-primary)" }}>{value}</div>
    </div>
  );
}
function StatusBar({ hist, name }: { hist: Pt[]; name: string }) {
  const pts = hist.slice(-40);
  return (
    <div style={{ display: "flex", gap: 1, height: "1.3cqmin", minHeight: 7, borderRadius: 3, overflow: "hidden", background: "var(--color-bg-input)", flex: 1 }}>
      {pts.length === 0 ? <div style={{ flex: 1 }} /> : pts.map((p, i) => <div key={i} style={{ flex: 1, background: scoreColor(p.statuses[name] ?? null) }} />)}
    </div>
  );
}
function Graph({ data, dataKey, color, label, gid, unit, fmt }: { data: Pt[]; dataKey: keyof Pt; color: string; label: string; gid: string; unit?: string; fmt?: (v: number) => string }) {
  const nums = data.map((p) => Number(p[dataKey])).filter((v) => Number.isFinite(v));
  const cur = nums.length ? nums[nums.length - 1]! : null;
  const peak = nums.length ? Math.max(...nums) : null;
  const min = nums.length ? Math.min(...nums) : 0;
  const max = peak ?? 1;
  // Zoom the Y axis to the data range (with padding) so small movements are visible.
  const pad = Math.max(1, (max - min) * 0.3);
  const domain: [number, number] = max === min ? [Math.max(0, min - 1), max + 1] : [Math.max(0, min - pad), max + pad];
  const show = (v: number | null) => (v == null ? "—" : fmt ? fmt(v) : Math.round(v).toLocaleString());
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--color-bg-panel-raised)", border: "1px solid var(--color-border)", borderRadius: "0.8cqmin", padding: "clamp(4px,0.8cqmin,12px)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: ".6cqmin" }}>
        <span style={{ color: "var(--color-text-secondary)", fontSize: "clamp(9px,1.2cqmin,22px)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span className="font-data" style={{ marginLeft: "auto", color, fontWeight: 800, fontSize: "clamp(12px,1.9cqmin,38px)" }}>{show(cur)}{unit ? <span style={{ fontSize: "0.55em", color: "var(--color-text-muted)" }}> {unit}</span> : null}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.5} /><stop offset="100%" stopColor={color} stopOpacity={0.05} /></linearGradient></defs>
            <YAxis hide domain={domain} />
            <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.4} fill={`url(#${gid})`} isAnimationActive={false} dot={false} connectNulls />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--color-text-muted)", fontSize: "clamp(8px,1cqmin,16px)" }}>
        <span>min {show(min)}</span><span>peak {show(peak)}</span>
      </div>
    </div>
  );
}

function Panel({ h, hist, big, allow }: { h: Host; hist: Pt[]; big?: boolean; allow?: string[] }) {
  // No override (undefined) = auto/show all. A present list (even empty) is honored exactly.
  const ok = (k: string) => !allow || allow.includes(k);
  const live = h.online || h.isDevice;
  const col = live ? OVERALL_COLOR[h.overall] : "var(--color-unknown)";
  const fault = live && (h.overall === "DOWN" || h.overall === "DEGRADED");
  const alerts: { text: string; sev: "down" | "warn" }[] = [];
  if (!h.online && !h.isDevice) alerts.push({ text: h.reachable === false ? "HOST UNREACHABLE — network / power" : "AGENT OFFLINE — host reachable", sev: "down" });
  for (const c of [...h.services, ...h.databases]) { if (c.status === "DOWN") alerts.push({ text: `${c.name} DOWN`, sev: "down" }); else if (c.status === "HANG" || c.status === "DEGRADED") alerts.push({ text: `${c.name} ${c.status}`, sev: "warn" }); }
  if (h.cpu != null && h.cpu >= 90) alerts.push({ text: `CPU ${Math.round(h.cpu)}%`, sev: "warn" });
  if (h.ram != null && h.ram >= 92) alerts.push({ text: `RAM ${Math.round(h.ram)}%`, sev: "warn" });
  const svcUp = h.services.filter((s) => s.status === "UP").length;
  const dbUp = h.databases.filter((s) => s.status === "UP").length;
  // Component rows follow the metric selection: services rows ↔ "services", db rows ↔ "databases".
  const comps = [
    { name: "Network", status: h.reachable === true ? "UP" : h.reachable === false ? "DOWN" : "UNKNOWN" },
    ...(ok("services") ? h.services : []),
    ...(ok("databases") ? h.databases : []),
  ];
  const hasDb = h.databases.length > 0;
  // Live graphs relevant to THIS host (purpose-specific; no empty/uniform graphs).
  const graphs: { key: keyof Pt; color: string; label: string; unit?: string; fmt?: (v: number) => string }[] = [];
  if (h.cpu != null && ok("cpu")) graphs.push({ key: "cpu", color: "#f59e0b", label: "CPU %", unit: "%" });
  if (h.ram != null && ok("ram")) graphs.push({ key: "ram", color: "#22c55e", label: "RAM %", unit: "%" });
  if (hasDb && ok("sessions")) graphs.push({ key: "sessions", color: "#60a5fa", label: "Sessions" });
  if (h.clients > 0 && ok("clients")) graphs.push({ key: "clients", color: "#3b82f6", label: "Clients" });
  if (h.rxBps != null && ok("net")) { graphs.push({ key: "rx", color: "#38bdf8", label: "Net in", fmt: fmtBps }); graphs.push({ key: "tx", color: "#fb923c", label: "Net out", fmt: fmtBps }); }
  if (h.diskPct != null && ok("storage")) graphs.push({ key: "disk", color: "#a78bfa", label: "Disk %", unit: "%" });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden", background: "var(--color-bg-panel)", border: `2px solid ${col}`, borderRadius: "clamp(8px,1.2cqmin,20px)", padding: "clamp(8px,1.3cqmin,24px)", gap: "clamp(5px,0.9cqmin,16px)", boxShadow: fault ? `0 0 0 2px ${col}, 0 0 clamp(8px,1.6cqmin,32px) ${col}` : "var(--shadow)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1cqmin", flexWrap: "wrap" }}>
        <span style={{ width: "1.2cqmin", height: "1.2cqmin", minWidth: 9, minHeight: 9, borderRadius: "50%", background: col, boxShadow: `0 0 1.2cqmin ${col}`, animation: fault ? "led-pulse-down 0.9s infinite" : undefined }} />
        <span style={{ fontWeight: 800, fontSize: big ? "clamp(24px,4cqmin,96px)" : "clamp(15px,2.1cqmin,44px)", color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{h.name}</span>
        <span style={{ fontWeight: 800, fontSize: big ? "clamp(18px,3cqmin,72px)" : "clamp(12px,1.7cqmin,32px)", color: col }}>{live ? h.overall : "OFFLINE"}</span>
        {h.lastSeen ? <span className="font-data" style={{ fontSize: "clamp(7px,0.95cqmin,15px)", color: "var(--color-text-dim)", opacity: 0.7 }} title="Last update from this host">upd {new Date(h.lastSeen).toLocaleTimeString()}</span> : null}
        <span style={{ marginLeft: "auto", display: "flex", gap: ".7cqmin", flexWrap: "wrap" }}>
          <Badge icon={h.reachable === false ? <WifiOff style={{ width: "1.6cqmin", minWidth: 13 }} /> : <Wifi style={{ width: "1.6cqmin", minWidth: 13 }} />} text={h.reachable === false ? "Net down" : h.reachable === true ? "Net OK" : "Net —"} color={h.reachable === false ? "var(--color-down)" : h.reachable === true ? "var(--color-up)" : "var(--color-unknown)"} />
          {!h.isDevice ? <Badge icon={<Radio style={{ width: "1.6cqmin", minWidth: 13 }} />} text={h.online ? "Agent on" : "Agent off"} color={h.online ? "var(--color-up)" : "var(--color-down)"} /> : null}
        </span>
      </div>

      {alerts.length === 0 ? (
        <div style={{ display: "inline-flex", alignItems: "center", gap: ".5cqmin", color: "var(--color-up)", fontWeight: 700, fontSize: "clamp(10px,1.35cqmin,24px)" }}><CircleCheck style={{ width: "1.5cqmin", minWidth: 12 }} /> All systems normal</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: ".5cqmin", animation: alerts.some((a) => a.sev === "down") ? "banner-blink 1.5s infinite" : undefined }}>
          {alerts.slice(0, big ? 10 : 5).map((a, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: ".4cqmin", padding: ".35cqmin .8cqmin", borderRadius: "0.6cqmin", fontWeight: 700, fontSize: "clamp(9px,1.3cqmin,24px)", color: a.sev === "down" ? "var(--color-down)" : "var(--color-hang)", background: a.sev === "down" ? "var(--color-down-glow)" : "var(--color-hang-glow)", border: `1px solid ${a.sev === "down" ? "var(--color-down)" : "var(--color-hang)"}66` }}><TriangleAlert style={{ width: "1.3cqmin", minWidth: 10 }} /> {a.text}</span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", columnGap: "clamp(14px,4cqmin,64px)", rowGap: "clamp(6px,1.2cqmin,18px)" }}>
        {h.services.length > 0 && ok("services") ? <BigStat label="Services" value={`${svcUp}/${h.services.length}`} tone={svcUp === h.services.length ? "var(--color-up)" : "var(--color-down)"} /> : null}
        {hasDb && ok("databases") ? <BigStat label="Databases" value={`${dbUp}/${h.databases.length}`} tone={dbUp === h.databases.length ? "var(--color-up)" : "var(--color-down)"} /> : null}
        {hasDb && ok("sessions") ? <BigStat label="Sessions" value={h.sessions.toLocaleString()} /> : null}
        {hasDb && h.connections > 0 && ok("databases") ? <BigStat label="Conns" value={h.connections.toLocaleString()} /> : null}
        {h.clients > 0 && ok("clients") ? <BigStat label="Clients" value={h.clients.toLocaleString()} /> : null}
        {h.cpu != null && ok("cpu") ? <BigStat label="CPU" value={`${Math.round(h.cpu)}%`} tone={h.cpu >= 90 ? "var(--color-down)" : h.cpu >= 75 ? "var(--color-hang)" : undefined} /> : null}
        {h.ram != null && ok("ram") ? <BigStat label="RAM" value={`${Math.round(h.ram)}%`} tone={h.ram >= 92 ? "var(--color-down)" : undefined} /> : null}
        {/* NAS shows per-share bars below; only show the single Disk stat when there are no shares to detail */}
        {h.stores.length === 0 && h.diskPct != null && ok("storage") ? <BigStat label="Disk" value={`${Math.round(h.diskPct)}%`} tone={h.diskPct >= 90 ? "var(--color-down)" : h.diskPct >= 80 ? "var(--color-hang)" : undefined} /> : null}
        {h.rxBps != null && ok("net") ? <BigStat label="Net ↓/↑" value={`${fmtBps(h.rxBps)} / ${fmtBps(h.txBps ?? 0)}`} /> : null}
      </div>

      {/* Custom SNMP OID readings (temperature, fans, etc.) chosen for this host */}
      {h.snmpItems.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", columnGap: "clamp(14px,4cqmin,64px)", rowGap: "clamp(6px,1.2cqmin,18px)" }}>
          {h.snmpItems.slice(0, big ? 12 : 6).map((it) => <BigStat key={it.label} label={it.label} value={`${it.value}${it.unit ? ` ${it.unit}` : ""}`} />)}
        </div>
      ) : null}

      {/* NAS / storage: a capacity bar per share/volume (richer than a single disk %) */}
      {h.stores.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "clamp(4px,0.8cqmin,12px)" }}>
          {h.stores.slice(0, big ? 10 : 4).map((s) => {
            const pct = s.usedPct ?? 0;
            const c = s.status === "DOWN" ? "var(--color-down)" : pct >= 90 ? "var(--color-down)" : pct >= 80 ? "var(--color-hang)" : "var(--color-up)";
            return (
              <div key={s.name}>
                <div style={{ display: "flex", fontSize: "clamp(9px,1.25cqmin,22px)", color: "var(--color-text-secondary)", marginBottom: "0.2cqmin" }}>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                  <span className="font-data" style={{ marginLeft: "auto", color: c }}>{s.usedPct != null ? `${Math.round(pct)}%` : s.status}{s.freeBytes != null ? ` · ${fmtBytes(s.freeBytes)} free` : ""}</span>
                </div>
                <div style={{ height: "clamp(6px,1cqmin,16px)", borderRadius: 4, background: "var(--color-bg-input)", overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: c, transition: "width .4s" }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* SNMP disk health summary (SMART status + worst temperature) */}
      {h.disks.length > 0 ? (() => {
        const okN = h.disks.filter((d) => !d.status || /ok|online|normal|good/i.test(d.status)).length;
        const temps = h.disks.map((d) => d.tempC).filter((t): t is number => t != null);
        const maxT = temps.length ? Math.max(...temps) : null;
        const allOk = okN === h.disks.length;
        return (
          <div style={{ display: "flex", alignItems: "center", gap: "1cqmin", fontSize: "clamp(9px,1.25cqmin,22px)" }}>
            <HardDrive style={{ width: "1.6cqmin", minWidth: 12, color: "var(--color-text-muted)" }} />
            <span style={{ color: allOk ? "var(--color-up)" : "var(--color-down)", fontWeight: 700 }}>{okN}/{h.disks.length} disks OK</span>
            {maxT != null ? <span style={{ color: maxT >= 55 ? "var(--color-down)" : maxT >= 45 ? "var(--color-hang)" : "var(--color-text-secondary)" }}>· {maxT}°C</span> : null}
          </div>
        );
      })() : null}

      {/* component status-over-time rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: ".5cqmin", overflow: "hidden" }}>
        {comps.slice(0, big ? 12 : 5).map((c) => (
          <div key={c.name} style={{ display: "flex", alignItems: "center", gap: "1cqmin" }}>
            <span style={{ width: "34%", minWidth: 0, fontWeight: 600, fontSize: "clamp(9px,1.25cqmin,22px)", color: "var(--color-text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
            <StatusBar hist={hist} name={c.name} />
            <span style={{ width: "5cqmin", textAlign: "right", color: wordColor(c.status), fontWeight: 800, fontSize: "clamp(9px,1.3cqmin,22px)" }}>{c.status === "UNKNOWN" ? "—" : c.status}</span>
          </div>
        ))}
      </div>

      {/* live graphs — only the metrics that apply to THIS host (no empty ping graph),
          shrink to fill remaining space (never clip the rows above) */}
      {graphs.length > 0 ? (
        <div style={{ display: "flex", gap: "clamp(6px,1cqmin,18px)", flex: 1, minHeight: 0 }}>
          {graphs.slice(0, big ? 4 : 3).map((g) => (
            <Graph key={g.key} data={hist} dataKey={g.key} color={g.color} label={g.label} gid={`g-${h.id}-${g.key}`} unit={g.unit} fmt={g.fmt} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FleetWall({ rotateSec, template = "flex", agentIds, metricsByHost, monitorsByHost, snmpByHost }: { rotateSec: number; template?: WallTemplate; agentIds?: string[] | null; metricsByHost?: Record<string, string[]>; monitorsByHost?: Record<string, string[]>; snmpByHost?: Record<string, { volumes?: string[]; items?: string[]; disks?: boolean }> }) {
  // null/undefined = all hosts; a present array (even empty) is the exact host set.
  const scope = agentIds == null ? null : new Set(agentIds);
  const { agents, monitors } = useDashboard(30_000); // poll so added/removed hosts surface live
  const { agents: liveAgents, unitFor } = useLiveState();
  const onlineById = useMemo(() => new Map(liveAgents.map((a) => [a.id, a])), [liveAgents]);
  const monsByAgent = useMemo(() => {
    const m = new Map<string, MonitorDTO[]>();
    for (const mon of monitors) { const l = m.get(mon.agentId) ?? []; l.push(mon); m.set(mon.agentId, l); }
    return m;
  }, [monitors]);

  const hosts = useMemo<Host[]>(() => agents.filter((a) => a.status !== "revoked").map((a: AgentDTO) => {
    const mons = monsByAgent.get(a.id) ?? [];
    const live = onlineById.get(a.id);
    const online = live?.online ?? false;
    const isDevice = a.kind === "device";
    const ping = mons.find((m) => m.type === "ping" && (m.config as { default?: unknown }).default === true);
    const pingUnit = ping ? unitFor(a.id, ping.name) : undefined;
    // Per-host monitor selection: when set, only those monitors are shown (ping/reachability
    // always stays). Empty/undefined = all of the host's monitors.
    const sel = monitorsByHost?.[a.id];
    const others = mons.filter((m) => m !== ping && (!sel || sel.includes(m.name)));
    const st = (m: MonitorDTO) => unitFor(a.id, m.name)?.status ?? (m.enabled ? "UNKNOWN" : "DOWN");
    const services = others.filter((m) => m.type !== "database" && m.type !== "storage").map((m) => ({ name: m.name, status: st(m) }));
    const databases = others.filter((m) => m.type === "database").map((m) => ({ name: m.name, status: st(m), db: { sessions: unitFor(a.id, m.name)?.meta?.db?.activeSessions ?? null } }));
    const sessions = databases.reduce((n, d) => n + (d.db?.sessions ?? 0), 0);
    const connections = others.reduce((n, m) => n + (unitFor(a.id, m.name)?.meta?.db?.connections ?? 0), 0);
    // SNMP samples on this host (NAS/appliances polled over SNMP report their own
    // CPU/RAM, NIC throughput, and storage VOLUMES here rather than as agent metrics).
    const snmps = others.filter((m) => m.type === "snmp").map((m) => unitFor(a.id, m.name)?.meta?.snmp).filter((s): s is NonNullable<typeof s> => Boolean(s));
    const nics = snmps.flatMap((s) => s.nics ?? []);
    const rxBps = nics.length ? nics.reduce((n, x) => n + (x.rxBps ?? 0), 0) : null;
    const txBps = nics.length ? nics.reduce((n, x) => n + (x.txBps ?? 0), 0) : null;
    const snmpCpu = snmps.find((s) => s.cpuPercent != null)?.cpuPercent ?? null;
    const snmpRam = snmps.find((s) => s.memUsedPct != null)?.memUsedPct ?? null;
    // Storage/NAS capacity — one bar per SMB share (meta.storage) AND per SNMP volume.
    const shareStores = others
      .filter((m) => unitFor(a.id, m.name)?.meta?.storage)
      .map((m) => {
        const s = unitFor(a.id, m.name)!.meta!.storage!;
        return { name: m.name, usedPct: s.usedPct ?? null, freeBytes: s.freeBytes ?? null, status: st(m) };
      });
    const volStores = snmps.flatMap((s) => (s.volumes ?? []).map((v) => ({ name: v.name, usedPct: v.usedPct, freeBytes: null as number | null, status: "UP" })));
    const snmpSel = snmpByHost?.[a.id];
    let stores = [...shareStores, ...volStores];
    if (snmpSel?.volumes) stores = stores.filter((s) => snmpSel.volumes!.includes(s.name));
    // Custom SNMP OID readings (temp/fans/etc.) are opt-in: shown only when selected.
    const snmpItems = snmpSel?.items
      ? snmps.flatMap((s) => s.items ?? []).filter((it) => snmpSel.items!.includes(it.label)).map((it) => ({ label: it.label, value: it.value, unit: it.unit }))
      : [];
    const disks = snmpSel?.disks === false ? [] : snmps.flatMap((s) => s.disks ?? []).map((d) => ({ name: d.name, status: d.status, tempC: d.tempC }));
    const diskPct = stores.length ? stores.reduce((m2, s) => Math.max(m2, s.usedPct ?? 0), 0) : null;
    const worst = shareStores.length ? shareStores.reduce((a2, b) => ((a2.usedPct ?? 0) >= (b.usedPct ?? 0) ? a2 : b)) : null;
    const overall: Overall = (isDevice || online) ? rollup(others.map(st)) : "UNKNOWN";
    return {
      id: a.id, name: a.name, online, overall, isDevice,
      reachable: pingUnit ? pingUnit.status === "UP" : null, rtt: pingUnit?.latencyMs ?? null,
      cpu: (online && !isDevice ? live?.cpuPct ?? null : null) ?? snmpCpu, ram: (online && !isDevice ? live?.memPct ?? null : null) ?? snmpRam,
      clients: (() => { const ips = new Set<string>(); for (const m of others) for (const c of unitFor(a.id, m.name)?.meta?.clients ?? []) if (c.ip) ips.add(c.ip); return ips.size; })(), sessions, connections,
      rxBps, txBps, diskPct, diskFreeBytes: worst?.freeBytes ?? null, lastSeen: a.lastSeenAt ?? null, services, databases, stores, snmpItems, disks,
    };
  }).filter((h) => !scope || scope.has(h.id))
    .sort((x, y) => RANK[x.overall] - RANK[y.overall] || x.name.localeCompare(y.name)), [agents, monsByAgent, onlineById, unitFor, agentIds, monitorsByHost, snmpByHost]);

  // Rolling history per host (incl. component statuses), sampled every 3s.
  const histRef = useRef<Map<string, Pt[]>>(new Map());
  const [, tick] = useState(0);
  useEffect(() => {
    const sample = () => {
      const now = Date.now();
      const seen = new Set<string>();
      for (const h of hosts) {
        seen.add(h.id);
        const statuses: Record<string, number | null> = { Network: h.reachable === true ? 1 : h.reachable === false ? 0 : null };
        for (const c of [...h.services, ...h.databases]) statuses[c.name] = (h.online || h.isDevice) ? statusScore(c.status) : null;
        const arr = histRef.current.get(h.id) ?? [];
        arr.push({ t: now, cpu: h.cpu ?? 0, ram: h.ram ?? 0, clients: h.clients, sessions: h.sessions, rx: h.rxBps ?? 0, tx: h.txBps ?? 0, disk: h.diskPct ?? 0, statuses });
        while (arr.length > HIST) arr.shift();
        histRef.current.set(h.id, arr);
      }
      for (const k of [...histRef.current.keys()]) if (!seen.has(k)) histRef.current.delete(k);
      tick((n) => n + 1);
    };
    sample();
    const t = setInterval(sample, 3000);
    return () => clearInterval(t);
  }, [hosts]);

  // Fit panels to the screen (no scroll) per the chosen template + rotate pages.
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [page, setPage] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const { cols, rows } = useMemo(() => {
    const fitC = Math.max(1, Math.floor(size.w / 460));
    const fitR = Math.max(1, Math.floor(size.h / 340));
    switch (template) {
      case "single": return { cols: 1, rows: 1 };
      case "cols2": return { cols: 2, rows: Math.max(1, Math.floor(size.h / 300)) };
      case "cols3": return { cols: 3, rows: Math.max(1, Math.floor(size.h / 300)) };
      case "rows2": return { cols: Math.max(1, Math.floor(size.w / 460)), rows: 2 };
      default: return { cols: fitC, rows: fitR };
    }
  }, [template, size]);
  const perPage = Math.max(1, cols * rows);
  const pages = Math.max(1, Math.ceil(hosts.length / perPage));
  useEffect(() => { if (rotateSec <= 0 || pages <= 1) return; const t = setInterval(() => setPage((p) => (p + 1) % pages), rotateSec * 1000); return () => clearInterval(t); }, [rotateSec, pages]);
  useEffect(() => { if (page >= pages) setPage(0); }, [page, pages]);
  const pageHosts = hosts.slice(page * perPage, page * perPage + perPage);

  return (
    <div ref={ref} className="h-full min-h-0 overflow-hidden p-3">
      {hosts.length === 0 ? (
        <div className="grid h-full place-items-center text-slate-500">No hosts reporting yet.</div>
      ) : (
        <div className="grid h-full gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
          {/* Each cell is a size-container so the panel scales to ITS cell (cqmin), not the
              viewport — fixes shrinking/clipping at fullscreen regardless of panel count. */}
          {pageHosts.map((h) => (
            <div key={h.id} className="min-h-0 min-w-0" style={{ containerType: "size" }}>
              <Panel h={h} hist={histRef.current.get(h.id) ?? []} big={template === "single"} allow={metricsByHost?.[h.id]} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
