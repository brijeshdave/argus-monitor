/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * SNMP panel: renders the rich device health collected server-side —
 * uptime, CPU %, memory %, storage volumes (bars), network interfaces (MAC/IP +
 * rx/tx throughput), and any profile-specific custom OID readings, grouped.
 */
import { useEffect, useMemo, useState } from "react";
import type { SnmpItem, SnmpSample } from "@argus/shared";
import { api } from "@/lib/api";
import { MetricChart, type ChartLine } from "@/components/MetricChart";
import { Tabs, type TabItem } from "@/components/Tabs";

const LINE_COLORS = ["#22c55e", "#38bdf8", "#f59e0b", "#a78bfa", "#f472b6", "#34d399", "#fb7185"];

function fmtUptime(min: number | null | undefined): string {
  if (min == null) return "—";
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = Math.floor(min % 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtBps(bps: number | null | undefined): string {
  if (bps == null) return "—";
  const bits = bps * 8;
  const u = ["bps", "Kbps", "Mbps", "Gbps"];
  let v = bits;
  let i = 0;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function Gauge({ label, pct }: { label: string; pct: number | null | undefined }) {
  const v = pct == null ? null : Math.max(0, Math.min(100, pct));
  const tone = v == null ? "bg-slate-700" : v >= 90 ? "bg-status-down" : v >= 75 ? "bg-status-degraded" : "bg-status-up";
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
      <div className="text-[0.65rem] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-slate-100">{v == null ? "—" : `${v.toFixed(0)}%`}</div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${v ?? 0}%` }} />
      </div>
    </div>
  );
}

export function SnmpPanel({ monitorId, name, snmp, status }: { monitorId: string; name: string; snmp: SnmpSample; status: string }) {
  const [period, setPeriod] = useState("hours=24");
  const [hist, setHist] = useState<Array<{ ts: string; metrics: Record<string, number> }>>([]);
  useEffect(() => {
    let cancelled = false;
    void api.get<{ points: Array<{ ts: string; metrics: Record<string, number> }> }>(`/api/monitors/${monitorId}/snmp-metrics?${period}`)
      .then((r) => !cancelled && setHist(r.points), () => {});
    return () => { cancelled = true; };
  }, [monitorId, period, snmp]);

  const { chartData, chartLines } = useMemo(() => {
    const keys = Array.from(new Set(hist.flatMap((p) => Object.keys(p.metrics)))).slice(0, 12);
    const data = hist.map((p) => ({ t: new Date(p.ts).getTime(), ...p.metrics }));
    const lines: ChartLine[] = keys.map((k, i) => ({ key: k, label: k, color: LINE_COLORS[i % LINE_COLORS.length]! }));
    return { chartData: data, chartLines: lines };
  }, [hist]);

  const [showAllNics, setShowAllNics] = useState(false);

  const groups = new Map<string, SnmpItem[]>();
  for (const it of snmp.items ?? []) {
    const g = it.group || "Readings";
    groups.set(g, [...(groups.get(g) ?? []), it]);
  }

  const allNics = snmp.nics ?? [];
  const withIp = allNics.filter((n) => (n.ips?.length ?? 0) > 0);
  const hiddenNics = allNics.length - withIp.length;
  const shownNics = showAllNics ? allNics : withIp;

  const hasGauges = snmp.cpuPercent != null || snmp.memUsedPct != null;
  const overviewNode = (
    <div className="space-y-4">
      {hasGauges ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {snmp.cpuPercent != null ? <Gauge label="CPU" pct={snmp.cpuPercent} /> : null}
          {snmp.memUsedPct != null ? <Gauge label="Memory" pct={snmp.memUsedPct} /> : null}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No CPU/memory reported by this device. See the other tabs for volumes, disks, and shares.</p>
      )}
    </div>
  );

  const volumesNode = (
    <div className="space-y-1">
      {(snmp.volumes ?? []).map((v) => (
        <div key={v.name} className="flex items-center gap-2 text-sm">
          <span className="w-44 truncate text-slate-300" title={v.name}>{v.name}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
            <div className={`h-full rounded-full ${v.usedPct >= 90 ? "bg-status-down" : v.usedPct >= 75 ? "bg-status-degraded" : "bg-status-up"}`} style={{ width: `${Math.max(2, Math.min(100, v.usedPct))}%` }} />
          </div>
          <span className="w-12 text-right tabular-nums text-slate-400">{v.usedPct.toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );

  const networkNode = (
    <div className="space-y-2">
      {hiddenNics > 0 ? (
        <button type="button" onClick={() => setShowAllNics((v) => !v)} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500">
          {showAllNics ? "Active only" : `Show all (+${hiddenNics} without IP)`}
        </button>
      ) : null}
      <div className="overflow-auto rounded-md border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Interface</th>
              <th className="px-3 py-2 font-medium">MAC</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium text-right">↓ Rx</th>
              <th className="px-3 py-2 font-medium text-right">↑ Tx</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {shownNics.map((n) => {
              const connected = (n.ips?.length ?? 0) > 0;
              return (
                <tr key={n.name} className={connected ? "text-slate-200" : "text-slate-500"}>
                  <td className="px-3 py-2">{n.name}{connected ? <span className="ml-1.5 rounded bg-status-up/15 px-1 py-0.5 text-[0.6rem] uppercase text-status-up">connected</span> : null}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{n.mac || "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{n.ips && n.ips.length ? n.ips.join(", ") : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">{fmtBps(n.rxBps)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">{fmtBps(n.txBps)}</td>
                </tr>
              );
            })}
            {shownNics.length === 0 ? <tr><td colSpan={5} className="px-3 py-4 text-slate-500">No interfaces with an IP. <button type="button" onClick={() => setShowAllNics(true)} className="underline">Show all {allNics.length}</button>.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );

  const disksNode = (
    <div className="overflow-auto rounded-md border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">Disk</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium text-right">Temp</th>
            <th className="px-3 py-2 font-medium">Model</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {(snmp.disks ?? []).map((d) => {
            const hot = d.tempC != null && d.tempC >= 50;
            return (
              <tr key={d.name} className="text-slate-200">
                <td className="px-3 py-2">{d.name}</td>
                <td className="px-3 py-2 text-slate-400">{d.status || "—"}{d.smart && d.smart !== d.status ? ` · ${d.smart}` : ""}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${hot ? "text-status-down" : "text-slate-400"}`}>{d.tempC != null ? `${d.tempC}°C` : "—"}</td>
                <td className="px-3 py-2 text-slate-500">{d.model || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const tableNode = (tbl: NonNullable<SnmpSample["tables"]>[number]) => (
    <div className="overflow-auto rounded-md border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
          <tr>{tbl.headers.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {tbl.rows.map((row, i) => (
            <tr key={i} className="text-slate-200">
              {row.map((cell, j) => {
                const header = (tbl.headers[j] ?? "").toLowerCase();
                const tempHot = header.includes("temp") && Number.parseFloat(cell) >= 50;
                const bad = header.includes("status") && cell && !/ok|good|normal|ready|healthy|^0$/i.test(cell);
                return <td key={j} className={`px-3 py-2 ${tempHot || bad ? "text-status-down" : "text-slate-300"}`}>{cell || "—"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const readingsNode = (
    <div className="space-y-3">
      {[...groups.entries()].map(([group, gItems]) => (
        <div key={group}>
          <div className="mb-1 text-[0.65rem] uppercase tracking-wide text-slate-500">{group}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {gItems.map((it) => (
              <div key={it.oid} className="rounded-md border border-slate-800 bg-slate-950/40 p-2" title={it.oid}>
                <div className="text-xs text-slate-500">{it.label}</div>
                <div className="font-mono text-sm text-slate-100">{it.value}{it.unit ? ` ${it.unit}` : ""}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const tabs: TabItem[] = [];
  if (snmp.reachable) {
    tabs.push({ key: "overview", label: "Overview", node: overviewNode });
    if ((snmp.volumes?.length ?? 0) > 0) tabs.push({ key: "volumes", label: `Volumes (${snmp.volumes!.length})`, node: volumesNode });
    if (allNics.length) tabs.push({ key: "network", label: `Network (${withIp.length})`, node: networkNode });
    if ((snmp.disks?.length ?? 0) > 0) tabs.push({ key: "disks", label: `Disks (${snmp.disks!.length})`, node: disksNode });
    for (const tbl of snmp.tables ?? []) tabs.push({ key: `tbl-${tbl.name}`, label: `${tbl.name} (${tbl.rows.length})`, node: tableNode(tbl) });
    if (groups.size) tabs.push({ key: "readings", label: "Readings", node: readingsNode });
    if (chartLines.length) tabs.push({ key: "history", label: "History", node: <MetricChart title="History" data={chartData} lines={chartLines} period={period} onPeriod={setPeriod} /> });
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-slate-100">{name}</h3>
        <span className="text-xs uppercase tracking-wide text-slate-500">SNMP · {snmp.reachable ? status : "unreachable"}</span>
        {snmp.reachable ? <span className="ml-auto text-xs text-slate-500">Uptime {fmtUptime(snmp.uptimeMin)}</span> : null}
      </div>
      {!snmp.reachable ? (
        <p className="text-sm text-status-down">Device unreachable{snmp.error ? ` — ${snmp.error}` : ""}. Check the host, community, and that SNMP is enabled/allowed.</p>
      ) : (
        <Tabs items={tabs} />
      )}
    </div>
  );
}
