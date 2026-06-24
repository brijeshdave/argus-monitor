/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Connected-clients table for an agent: search across name/IP/MAC/service, sortable
 * columns, and client-side pagination. Hostname falls back to the admin override
 * (ClientMeta) then the agent-resolved reverse-DNS/NetBIOS name.
 */
import { useMemo, useState } from "react";
import type { ClientSample, ClientMetaDTO } from "@argus/shared";

type Row = ClientSample & { service: string };
type SortKey = "name" | "ip" | "mac" | "service" | "port";

const PAGE_SIZES = [25, 50, 100];

/** Numeric-aware IP compare so 10.2.0.9 sorts before 10.2.0.10. */
function ipKey(ip: string): number {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isFinite(n)) ? ((p[0]! * 256 + p[1]!) * 256 + p[2]!) * 256 + p[3]! : 0;
}

export function ClientsTable({ clients, metaByIp, canEdit, onEdit }: {
  clients: Row[];
  metaByIp: Map<string, ClientMetaDTO>;
  canEdit: boolean;
  onEdit: (c: { ip: string; hostname: string; description: string }) => void;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [dir, setDir] = useState<1 | -1>(1);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);

  const enriched = useMemo(() => clients.map((c) => {
    const meta = metaByIp.get(c.ip);
    return { ...c, name: meta?.hostname || c.hostname || "", description: meta?.description || "", dns: c.hostname || "" };
  }), [clients, metaByIp]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle
      ? enriched.filter((c) => `${c.name} ${c.ip} ${c.mac ?? ""} ${c.service} ${c.description}`.toLowerCase().includes(needle))
      : enriched;
    const cmp = (a: typeof rows[number], b: typeof rows[number]): number => {
      switch (sort) {
        case "ip": return ipKey(a.ip) - ipKey(b.ip);
        case "mac": return (a.mac ?? "").localeCompare(b.mac ?? "");
        case "service": return a.service.localeCompare(b.service);
        case "port": return a.port - b.port;
        default: return (a.name || "~").localeCompare(b.name || "~"); // blanks last
      }
    };
    return [...rows].sort((a, b) => cmp(a, b) * dir);
  }, [enriched, q, sort, dir]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);
  if (page > pages - 1 && page !== 0) setPage(0);

  const header = (key: SortKey, label: string, extra = "") => (
    <th className={`px-4 py-3 font-medium ${extra}`}>
      <button type="button" onClick={() => { if (sort === key) setDir((d) => (d === 1 ? -1 : 1)); else { setSort(key); setDir(1); } }} className="inline-flex items-center gap-1 hover:text-slate-200">
        {label}{sort === key ? <span className="text-sky-400">{dir === 1 ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Filter by name, IP, MAC, service…"
          className="w-72 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500" />
        <span className="text-xs text-slate-500">{filtered.length} client{filtered.length === 1 ? "" : "s"}{q ? ` (of ${enriched.length})` : ""}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/40">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {header("name", "Client")}
              {header("ip", "IP")}
              {header("mac", "MAC")}
              <th className="px-4 py-3 font-medium">Description</th>
              {header("service", "Service")}
              {header("port", "Port")}
              {canEdit ? <th className="px-4 py-3 text-right font-medium">Edit</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {pageRows.map((c, i) => (
              <tr key={`${c.service}:${c.ip}:${c.port}:${i}`} className="text-slate-200">
                <td className="px-4 py-3">
                  {c.name || <span className="text-slate-500">unresolved</span>}
                  {c.name && c.dns && c.name !== c.dns ? <span className="ml-1 text-xs text-slate-600">(dns: {c.dns})</span> : null}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{c.ip}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{c.mac || "—"}</td>
                <td className="px-4 py-3 text-slate-400">{c.description || "—"}</td>
                <td className="px-4 py-3 text-slate-400">{c.service}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{c.port}</td>
                {canEdit ? (
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => onEdit({ ip: c.ip, hostname: metaByIp.get(c.ip)?.hostname ?? "", description: metaByIp.get(c.ip)?.description ?? "" })}
                      className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500">Edit</button>
                  </td>
                ) : null}
              </tr>
            ))}
            {pageRows.length === 0 ? (
              <tr><td colSpan={canEdit ? 7 : 6} className="px-4 py-6 text-center text-sm text-slate-500">No clients match.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {filtered.length > PAGE_SIZES[0]! ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <label className="flex items-center gap-1">
            Rows
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="rounded-md border border-slate-700 px-2 py-1 disabled:opacity-40">Prev</button>
            <span>Page {page + 1} / {pages}</span>
            <button type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} className="rounded-md border border-slate-700 px-2 py-1 disabled:opacity-40">Next</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
