/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Structured config fields for storage / database monitors, shared by the create
 * form and the edit modal (no raw JSON). On edit the password is left blank and a
 * "leave blank to keep" hint is shown — secrets are write-only.
 */
import { useEffect, useState } from "react";
import { CHECK_INTERVALS, PING_COUNTS, RETRY_INTERVALS, type SnmpProfileDTO } from "@argus/shared";
import { api } from "@/lib/api";
import type { MonitorFieldValues } from "@/lib/monitorForm";

const inputCls =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";

/** Per-monitor schedule controls shared by ping/http/tcp/dns (count = ping only). */
function ScheduleFields({
  values, set, showCount,
}: {
  values: MonitorFieldValues;
  set: (patch: Partial<MonitorFieldValues>) => void;
  showCount?: boolean;
}) {
  return (
    <div className={`grid gap-4 border-t border-slate-800 pt-4 ${showCount ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Check interval</span>
        <select value={values.interval} onChange={(e) => set({ interval: Number(e.target.value) })} className={inputCls}>
          {CHECK_INTERVALS.map((o) => <option key={o.sec} value={o.sec}>{o.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Retries</span>
        <select value={values.retries} onChange={(e) => set({ retries: Number(e.target.value) })} className={inputCls}>
          {[0, 1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Retry interval</span>
        <select value={values.retryInterval} disabled={values.retries === 0} onChange={(e) => set({ retryInterval: Number(e.target.value) })} className={`${inputCls} disabled:opacity-50`}>
          {RETRY_INTERVALS.map((o) => <option key={o.sec} value={o.sec}>{o.label}</option>)}
        </select>
      </label>
      {showCount ? (
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Ping packets</span>
          <select value={values.count} onChange={(e) => set({ count: Number(e.target.value) })} className={inputCls}>
            {PING_COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  );
}

export function MonitorCredFields({
  type, values, onChange, editing = false,
}: {
  type: string;
  values: MonitorFieldValues;
  onChange: (v: MonitorFieldValues) => void;
  editing?: boolean;
}) {
  const set = (patch: Partial<MonitorFieldValues>) => onChange({ ...values, ...patch });
  const pwHint = editing ? "leave blank to keep current" : "stored encrypted";

  // SNMP device profiles (the "MIB master") for the profile picker.
  const [profiles, setProfiles] = useState<SnmpProfileDTO[]>([]);
  useEffect(() => {
    if (type !== "snmp") return;
    void api.get<{ rows: SnmpProfileDTO[] }>("/api/snmp-profiles").then((r) => setProfiles(r.rows), () => {});
  }, [type]);

  if (type === "storage") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Share path</span>
          <input value={values.path} onChange={(e) => set({ path: e.target.value })} placeholder="\\10.2.0.31\kos_el_images  or  /data/kos_el_images" className={`${inputCls} font-mono`} />
          <span className="mt-1 block text-xs text-slate-500">A <b>UNC</b> path (<code>{"\\\\host\\share"}</code>) for a remote SMB share, or a <b>local path</b> (e.g. <code>/data/kos_el_images</code>) when the agent runs on the host/NAS — local is read directly off disk (fast, any depth).</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Username (SMB only)</span>
          <input value={values.user} onChange={(e) => set({ user: e.target.value })} placeholder="DOMAIN\\svc — blank for local" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Password (SMB only)</span>
          <input type="password" value={values.password} onChange={(e) => set({ password: e.target.value })} placeholder={editing ? pwHint : "blank for local path"} className={inputCls} />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300 sm:col-span-2">
          <input type="checkbox" checked={values.server} onChange={(e) => set({ server: e.target.checked })} className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-sky-500" />
          Probe from the Argus host (no agent) — connects to the share over SMB
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300 sm:col-span-2">
          <input type="checkbox" checked={values.folders} onChange={(e) => set({ folders: e.target.checked })} className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-sky-500" />
          Collect top-folder sizes (refreshed every ~15 min)
        </label>
        <div className="block sm:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-slate-500">Watched folders — each with its own depth + scan period</span>
            <button
              type="button"
              onClick={() => set({ watchFolders: [...values.watchFolders, { path: "", depth: 1, refreshMin: 15, refreshUnit: "minutes", scanTimes: [], scanTZ: "" }] })}
              className="rounded-md border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:border-slate-500"
            >
              + Add folder
            </button>
          </div>
          {values.watchFolders.length === 0 ? (
            <p className="text-xs text-slate-600">No watched folders. Add a subfolder (relative to the share) to size it on its own schedule — use <code>.</code> for the whole share.</p>
          ) : null}
          <div className="space-y-1.5">
            {/* header row */}
            <div className="hidden gap-2 px-1 text-[0.6rem] uppercase tracking-wide text-slate-500 sm:flex">
              <span className="flex-1">Folder (relative to share)</span>
              <span className="w-24">Depth</span>
              <span className="w-44">Schedule</span>
              <span className="w-6" />
            </div>
            {values.watchFolders.map((row, i) => {
              const setRow = (patch: Partial<typeof row>) => {
                const next = values.watchFolders.map((r, j) => (j === i ? { ...r, ...patch } : r));
                set({ watchFolders: next });
              };
              const daily = row.scanTimes.length > 0;
              return (
                <div key={i} className="rounded-md border border-slate-800 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={row.path} onChange={(e) => setRow({ path: e.target.value })} placeholder=".  (or subfolder/path)" className={`${inputCls} flex-1 font-mono text-xs`} />
                    <select value={row.depth} onChange={(e) => setRow({ depth: Number(e.target.value) })} className={`${inputCls} w-24`}>
                      {[1, 2, 3, 4, 5, 6, 8, 10, 15, 20].map((d) => <option key={d} value={d}>{d} levels</option>)}
                      <option value={0}>Unlimited</option>
                    </select>
                    <select value={daily ? "daily" : "interval"} onChange={(e) => setRow(e.target.value === "daily" ? { scanTimes: row.scanTimes.length ? row.scanTimes : ["08:00"] } : { scanTimes: [] })} className={`${inputCls} w-32 text-xs`}>
                      <option value="interval">every (interval)</option>
                      <option value="daily">daily at times</option>
                    </select>
                    {!daily ? (
                      <span className="flex items-center gap-1">
                        <input type="number" min={1} value={row.refreshUnit === "hours" ? Math.max(1, Math.round(row.refreshMin / 60)) : row.refreshMin}
                          onChange={(e) => { const v = Math.max(1, Number(e.target.value) || 1); setRow({ refreshMin: row.refreshUnit === "hours" ? v * 60 : v }); }}
                          className={`${inputCls} w-16 text-xs`} />
                        <select value={row.refreshUnit} onChange={(e) => { const u = e.target.value as "minutes" | "hours"; const cur = row.refreshUnit === "hours" ? row.refreshMin / 60 : row.refreshMin; setRow({ refreshUnit: u, refreshMin: u === "hours" ? Math.max(1, Math.round(cur)) * 60 : Math.max(1, Math.round(cur)) }); }} className={`${inputCls} w-20 text-xs`}>
                          <option value="minutes">min</option>
                          <option value="hours">hours</option>
                        </select>
                      </span>
                    ) : null}
                    <button type="button" onClick={() => set({ watchFolders: values.watchFolders.filter((_, j) => j !== i) })} title="Remove folder" className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500">✕</button>
                  </div>
                  {daily ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
                      <span className="text-[0.65rem] uppercase tracking-wide text-slate-500">Scan daily at</span>
                      {row.scanTimes.map((t, ti) => (
                        <span key={ti} className="flex items-center gap-0.5">
                          <input type="time" value={t} onChange={(e) => setRow({ scanTimes: row.scanTimes.map((x, k) => (k === ti ? e.target.value : x)) })} className={`${inputCls} w-24 text-xs`} />
                          <button type="button" onClick={() => setRow({ scanTimes: row.scanTimes.filter((_, k) => k !== ti) })} className="px-1 text-xs text-slate-500 hover:text-rose-300">✕</button>
                        </span>
                      ))}
                      <button type="button" onClick={() => setRow({ scanTimes: [...row.scanTimes, "12:00"] })} className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:border-slate-500">+ time</button>
                      <input value={row.scanTZ} onChange={(e) => setRow({ scanTZ: e.target.value })} placeholder="Timezone (e.g. Asia/Kolkata)" title="Blank = agent local time" className={`${inputCls} w-44 text-xs`} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <span className="mt-1 block text-xs text-slate-500">Each folder is sized recursively (with file counts) on its own period; depth breaks it into sub‑levels. Runs on the <b>agent</b> host — or, with “Probe from the Argus host” enabled, server-side over SMB (works for an agentless device).</span>
        </div>
      </div>
    );
  }

  if (type === "snmp") {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Device host / IP</span>
            <input value={values.host} onChange={(e) => set({ host: e.target.value })} placeholder="10.2.0.31" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">SNMP version</span>
            <select value={values.snmpVersion} onChange={(e) => set({ snmpVersion: e.target.value })} className={inputCls}>
              <option value="2c">v2c</option>
              <option value="1">v1</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Community</span>
            <input type="password" value={values.community} onChange={(e) => set({ community: e.target.value })} placeholder={editing ? "leave blank to keep" : "public"} className={inputCls} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Device profile</span>
          <select value={values.profileId} onChange={(e) => set({ profileId: e.target.value })} className={inputCls}>
            <option value="">Standard (HOST-RESOURCES / IF-MIB)</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.vendor ? ` · ${p.vendor}` : ""}</option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            Profiles (the MIB master) live under Settings → SNMP profiles. Polled server-side; community stored encrypted.
          </span>
        </label>
      </div>
    );
  }

  if (type === "ping") {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Host / IP (optional)</span>
            <input value={values.host} onChange={(e) => set({ host: e.target.value })} placeholder="blank = use the device's address" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">TCP port (optional)</span>
            <input value={values.port} onChange={(e) => set({ port: e.target.value })} placeholder="blank = ICMP echo" className={inputCls} />
          </label>
        </div>
        <ScheduleFields values={values} set={set} showCount />
        <p className="text-xs text-slate-500">Probed from the Argus host. With a port set it uses a TCP connect instead of ICMP (a refused connection still proves reachability).</p>
      </div>
    );
  }

  if (type === "http") {
    return (
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">URL</span>
          <input value={values.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/health" className={`${inputCls} font-mono`} />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Method</span>
            <select value={values.method} onChange={(e) => set({ method: e.target.value })} className={inputCls}>
              {["GET", "HEAD", "POST", "PUT", "OPTIONS"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Accept status</span>
            <input value={values.expectedStatus} onChange={(e) => set({ expectedStatus: e.target.value })} placeholder="blank = 2xx/3xx · e.g. 200,301,500-599" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Body keyword (optional)</span>
            <input value={values.keyword} onChange={(e) => set({ keyword: e.target.value })} placeholder="must contain…" className={inputCls} />
          </label>
        </div>
        <ScheduleFields values={values} set={set} />
        <p className="text-xs text-slate-500">UP when the status matches (and the keyword is present, if set).</p>
      </div>
    );
  }

  if (type === "tcp") {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Host / IP</span>
            <input value={values.host} onChange={(e) => set({ host: e.target.value })} placeholder="10.2.0.31" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Port</span>
            <input value={values.port} onChange={(e) => set({ port: e.target.value })} placeholder="5432" className={inputCls} />
          </label>
        </div>
        <ScheduleFields values={values} set={set} />
        <p className="text-xs text-slate-500">UP when a TCP connection opens from the Argus host. Works for any service/DB port (Postgres, MySQL, Redis, SMTP, …).</p>
      </div>
    );
  }

  if (type === "dns") {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block sm:col-span-1">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Hostname</span>
            <input value={values.host} onChange={(e) => set({ host: e.target.value })} placeholder="example.com" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Record type</span>
            <select value={values.recordType} onChange={(e) => set({ recordType: e.target.value })} className={inputCls}>
              {["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Resolver (optional)</span>
            <input value={values.resolver} onChange={(e) => set({ resolver: e.target.value })} placeholder="1.1.1.1 (blank = system)" className={inputCls} />
          </label>
        </div>
        <ScheduleFields values={values} set={set} />
        <p className="text-xs text-slate-500">UP when the hostname resolves the chosen record type (optionally via a specific DNS server).</p>
      </div>
    );
  }

  // database — discrete fields
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Host</span>
          <input value={values.host} onChange={(e) => set({ host: e.target.value })} placeholder="10.2.0.31 or SRV\\INST" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Port</span>
          <input value={values.port} onChange={(e) => set({ port: e.target.value })} placeholder="1433" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Database</span>
          <input value={values.database} onChange={(e) => set({ database: e.target.value })} placeholder="(optional)" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Username</span>
          <input value={values.user} onChange={(e) => set({ user: e.target.value })} placeholder="monitor" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Password</span>
          <input type="password" value={values.password} onChange={(e) => set({ password: e.target.value })} placeholder={pwHint} className={inputCls} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={values.encrypt} onChange={(e) => set({ encrypt: e.target.checked })} className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-sky-500" />
          Encrypt connection
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={values.collectQueries} onChange={(e) => set({ collectQueries: e.target.checked })} className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-sky-500" />
          Collect top queries
        </label>
        {values.collectQueries ? (
          <label className="flex items-center gap-2 text-sm text-slate-400">
            Top N
            <input type="number" min={1} max={100} value={values.topN} onChange={(e) => set({ topN: Math.max(1, Number(e.target.value)) })} className={`${inputCls} w-20`} />
          </label>
        ) : null}
      </div>
      <p className="text-xs text-slate-500">A read-only login with VIEW SERVER STATE is recommended. Credentials are stored encrypted and sent only to this agent.</p>
    </div>
  );
}
