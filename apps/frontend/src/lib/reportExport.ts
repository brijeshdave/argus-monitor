/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Report export: turn a ReportDoc into a titled table, then export it as CSV
 * (opens in Excel), a printable HTML document (Print → Save as PDF), or JSON. All
 * client-side — no server-side Excel/PDF libraries.
 */
import type { ReportDoc } from "@/hooks/useReports";

export interface ReportTable {
  title: string;
  subtitle: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

/** Human-readable byte size (B → PB). */
function fmtBytes(b: number | null | undefined): string {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

/** Flatten a report's primary data into a single titled table for display/export. */
export function toTable(doc: ReportDoc): ReportTable {
  const when = new Date(doc.generatedAt).toLocaleString();
  const scope = doc.scopeLabel ?? (doc.scope.kind === "all" ? "All monitors" : `${doc.scope.kind} ${doc.scope.refId ?? ""}`.trim());
  const window = doc.windowLabel ?? `${doc.days}d`;
  const subtitle = `${scope} · ${window} · Generated: ${when}`;
  const d = doc.data as Record<string, unknown>;

  if (doc.type === "summary") {
    const s = d as {
      overallUptimePct: number; incidentCount: number; agentsTotal: number; monitorsTotal: number; monitorsEnabled: number;
      worstMonitors: Array<{ label: string; uptimePct: number }>;
      topIncidentMonitors: Array<{ entity: string; count: number }>;
      storageAlerts: Array<{ name: string; usedPct: number }>;
    };
    const rows: Array<Array<string | number>> = [
      ["Overall uptime", `${s.overallUptimePct.toFixed(2)}%`],
      ["Incidents (window)", s.incidentCount],
      ["Monitored hosts", s.agentsTotal],
      ["Monitors (enabled / total)", `${s.monitorsEnabled} / ${s.monitorsTotal}`],
      ...s.worstMonitors.map((m) => [`Low availability — ${m.label}`, `${m.uptimePct.toFixed(2)}%`] as Array<string | number>),
      ...s.topIncidentMonitors.map((m) => [`Incidents — ${m.entity}`, m.count] as Array<string | number>),
      ...s.storageAlerts.map((x) => [`Storage — ${x.name}`, `${x.usedPct.toFixed(1)}%`] as Array<string | number>),
    ];
    return { title: "Executive summary", subtitle, columns: ["Metric", "Value"], rows };
  }

  if (doc.type === "uptime") {
    const rows = (d.rows as Array<{ label: string; uptimePct: number }>) ?? [];
    return {
      title: "Uptime report",
      subtitle: `${subtitle} · Overall: ${((d.overallPct as number) ?? 0).toFixed(2)}%`,
      columns: ["Monitor", "Uptime %"],
      rows: rows.map((r) => [r.label, r.uptimePct.toFixed(2)]),
    };
  }
  if (doc.type === "incidents") {
    const items = (d.items as Array<{ entity: string; newStatus: string | null; ts: string }>) ?? [];
    return {
      title: "Incidents report",
      subtitle: `${subtitle} · ${(d.count as number) ?? items.length} incident(s)`,
      columns: ["Time", "Monitor", "Status"],
      rows: items.map((i) => [new Date(i.ts).toLocaleString(), i.entity, i.newStatus ?? ""]),
    };
  }
  if (doc.type === "resource") {
    const rows = (d.rows as Array<{ name: string; kind: "host" | "process"; avgCpu: number | null; peakCpu: number | null; avgMem: number | null; memUnit: "%" | "MB" }>) ?? [];
    const num = (v: number | null, unit = "") => (v == null ? "—" : `${v}${unit}`);
    return {
      title: "Resource usage (CPU / RAM)",
      subtitle,
      columns: ["Name", "Kind", "Avg CPU %", "Peak CPU %", "Avg memory"],
      rows: rows.map((r) => [r.name, r.kind, num(r.avgCpu), num(r.peakCpu), num(r.avgMem, r.memUnit === "MB" ? " MB" : "%")] as Array<string | number>),
    };
  }
  if (doc.type === "storage") {
    const mons = (d.monitors as Array<{ name: string; days: Array<{ date: string; usedPct: number | null; usedBytes: number | null; totalBytes: number | null }> }>) ?? [];
    const rows = mons
      .flatMap((m) => m.days.map((day) => [day.date, m.name, day.usedPct == null ? "—" : day.usedPct.toFixed(1), fmtBytes(day.usedBytes), fmtBytes(day.totalBytes)] as Array<string | number>))
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return {
      title: "Storage report (datewise)",
      subtitle: `${subtitle} · ${mons.length} share(s)`,
      columns: ["Date", "Share", "Used %", "Used", "Total"],
      rows,
    };
  }
  if (doc.type === "storage-detail") {
    const mons = (d.monitors as Array<{
      name: string;
      current: { usedPct: number | null; usedBytes: number | null; totalBytes: number | null; freeBytes: number | null };
      topFolders: Array<{ folder: string; sizeBytes: number | null; fileCount: number | null; folderCount: number | null }>;
    }>) ?? [];
    const rows: Array<Array<string | number>> = [];
    for (const m of mons) {
      rows.push([
        m.name,
        "— capacity —",
        m.current.usedPct == null ? "—" : `${m.current.usedPct.toFixed(1)}%`,
        `used ${fmtBytes(m.current.usedBytes)} · free ${fmtBytes(m.current.freeBytes)} · total ${fmtBytes(m.current.totalBytes)}`,
        "",
      ]);
      for (const f of m.topFolders) {
        rows.push([m.name, f.folder, fmtBytes(f.sizeBytes), f.fileCount == null ? "—" : f.fileCount.toLocaleString(), f.folderCount == null ? "—" : f.folderCount.toLocaleString()]);
      }
    }
    return {
      title: "Storage report (detailed + folders)",
      subtitle: `${subtitle} · ${mons.length} share(s)`,
      columns: ["Share", "Folder", "Size", "Files", "Sub-folders"],
      rows,
    };
  }
  // inventory — agents + monitors flattened into one list.
  const ags = (d.agents as Array<{ name: string; platform: string | null; status: string; version: string | null }>) ?? [];
  const mons = (d.monitors as Array<{ name: string; type: string; enabled: boolean; agentName: string }>) ?? [];
  return {
    title: "Inventory report",
    subtitle,
    columns: ["Kind", "Name", "Detail", "Status"],
    rows: [
      ...ags.map((a) => ["agent", a.name, `${a.platform ?? ""} ${a.version ?? ""}`.trim(), a.status] as Array<string | number>),
      ...mons.map((m) => ["monitor", m.name, `${m.type} · ${m.agentName}`, m.enabled ? "enabled" : "disabled"] as Array<string | number>),
    ],
  };
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV (Excel-openable). */
export function exportCsv(doc: ReportDoc): void {
  const t = toTable(doc);
  const lines = [t.columns.map(csvCell).join(","), ...t.rows.map((r) => r.map(csvCell).join(","))];
  triggerDownload(new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `${doc.type}-report.csv`);
}

/** JSON (raw report document). */
export function exportJson(doc: ReportDoc): void {
  triggerDownload(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }), `${doc.type}-report.json`);
}

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

/**
 * Serialise the currently-rendered report charts (KPI tiles + Recharts SVGs) from
 * the live DOM into self-contained HTML for the print window. Recharts wrappers
 * carry their styling inline, so they render faithfully without app CSS.
 */
function collectChartsHtml(rootId: string): string {
  const root = document.getElementById(rootId);
  if (!root) return "";

  let kpis = "";
  const kpiEls = root.querySelectorAll<HTMLElement>("[data-kpi]");
  if (kpiEls.length) {
    kpis =
      `<div class="kpis">` +
      [...kpiEls]
        .map((e) => `<div class="kpi"><div class="kv">${esc(e.dataset.kpiValue ?? "")}</div><div class="kl">${esc(e.dataset.kpiLabel ?? "")}</div></div>`)
        .join("") +
      `</div>`;
  }

  let charts = "";
  for (const fig of root.querySelectorAll<HTMLElement>("figure[data-chart-title]")) {
    const wrapper = fig.querySelector(".recharts-wrapper");
    if (!wrapper) continue;
    charts += `<figure class="chart"><figcaption>${esc(fig.dataset.chartTitle ?? "")}</figcaption>${wrapper.outerHTML}</figure>`;
  }
  return kpis + charts;
}

/**
 * Build a self-contained, print-optimised HTML document for a report: title,
 * scope/window, KPI tiles, the rendered charts (SVG) and the detail table. Light
 * theme with darkened chart text + soft gridlines so it reads cleanly on paper.
 * `autoPrint` triggers the browser print dialog (used for the PDF path).
 */
function buildReportHtml(doc: ReportDoc, chartsRootId: string | undefined, autoPrint: boolean): string {
  const t = toTable(doc);
  const head = t.columns.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(String(c))}</td>`).join("")}</tr>`).join("");
  const charts = chartsRootId ? wrapCharts(collectChartsHtml(chartsRootId)) : "";
  const printScript = autoPrint ? `<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.title)}</title>
    <style>
      :root{color-scheme:light}
      *{box-sizing:border-box}
      body{font-family:Inter,system-ui,Segoe UI,sans-serif;color:#0f172a;margin:0;padding:28px;font-size:13px;line-height:1.45;background:#fff}
      header{border-bottom:2px solid #0ea5e9;padding-bottom:10px;margin-bottom:18px}
      h1{font-size:22px;margin:0 0 4px;color:#0f172a}
      .sub{color:#475569;font-size:12.5px}
      .kpis{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 22px}
      .kpi{border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;min-width:140px;background:#f8fafc}
      .kpi .kv{font-size:22px;font-weight:700;color:#0f172a} .kpi .kl{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-top:4px}
      .charts{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:22px}
      .chart{page-break-inside:avoid;break-inside:avoid;border:1px solid #e2e8f0;border-radius:10px;padding:12px}
      .chart figcaption{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#334155;margin-bottom:8px}
      .chart{margin:0}
      /* Recharts renders light-grey text + dark grid for the dark app theme;
         re-tone both for white paper so axes/labels stay legible. */
      .chart svg{max-width:100%;height:auto}
      .chart svg text{fill:#111827 !important;font-size:12px !important;font-weight:500}
      .chart svg .recharts-cartesian-grid line{stroke:#e5e7eb !important}
      .chart svg .recharts-cartesian-axis-line,.chart svg .recharts-cartesian-axis-tick-line{stroke:#cbd5e1 !important}
      h2{font-size:15px;margin:22px 0 10px;color:#0f172a}
      table{border-collapse:collapse;width:100%;font-size:12px}
      th,td{border:1px solid #e2e8f0;padding:7px 10px;text-align:left;vertical-align:top}
      th{background:#0ea5e9;color:#fff;font-weight:600;position:sticky;top:0}
      tr:nth-child(even) td{background:#f8fafc}
      td:nth-child(n+3){font-variant-numeric:tabular-nums}
      footer{margin-top:24px;color:#94a3b8;font-size:10.5px;border-top:1px solid #e2e8f0;padding-top:8px}
      @media print{body{padding:0}@page{margin:12mm}.charts{grid-template-columns:1fr 1fr}}
    </style></head><body>
    <header><h1>${esc(t.title)}</h1><div class="sub">${esc(t.subtitle)}</div></header>
    ${charts}
    <h2>Detail</h2>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    <footer>Generated by Argus · ${esc(new Date().toLocaleString())}</footer>
    ${printScript}
    </body></html>`;
}

/** Wrap collected KPI + chart fragments in a grid so the print/HTML view lays out. */
function wrapCharts(fragments: string): string {
  if (!fragments) return "";
  // collectChartsHtml emits .kpis (a flex row) then a sequence of <figure class="chart">.
  const kpiMatch = fragments.match(/^<div class="kpis">[\s\S]*?<\/div>/);
  const kpis = kpiMatch ? kpiMatch[0] : "";
  const rest = kpis ? fragments.slice(kpis.length) : fragments;
  return `${kpis}<div class="charts">${rest}</div>`;
}

/** Open a standalone, styled HTML report and invoke print → operators Save as PDF. */
export function printReport(doc: ReportDoc, chartsRootId?: string): void {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(buildReportHtml(doc, chartsRootId, true));
  w.document.close();
}

/** Download the report as a self-contained .html file (charts + table embedded). */
export function exportHtml(doc: ReportDoc, chartsRootId?: string): void {
  const html = buildReportHtml(doc, chartsRootId, false);
  triggerDownload(new Blob([html], { type: "text/html;charset=utf-8" }), `${doc.type}-report.html`);
}
