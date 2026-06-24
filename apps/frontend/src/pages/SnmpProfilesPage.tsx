/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * SNMP profiles — the "MIB master". List built-in + custom profiles (by vendor /
 * device type / model), create/edit/delete custom ones, edit their OID set, and
 * import/export profiles as JSON. Built-in (system) profiles are read-only; clone to
 * customize. An SNMP monitor picks a profile to decide what it collects.
 */
import { useEffect, useState } from "react";
import type { SnmpProfileDTO, SnmpProfileInput, SnmpProfileOid, SnmpProfileTable } from "@argus/shared";
import { SNMP_DEVICE_TYPES } from "@argus/shared";
import { useSnmpProfiles } from "@/hooks/useSnmpProfiles";
import { api } from "@/lib/api";
import { useAuth } from "@/auth/AuthContext";
import { useConfirm } from "@/components/ConfirmProvider";
import { Spinner } from "@/components/Spinner";
import { Modal } from "@/components/Modal";

const inputCls = "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";

interface EditState {
  id: string | null; // null = new
  name: string;
  vendor: string;
  deviceType: string;
  model: string;
  standard: boolean;
  oids: SnmpProfileOid[];
  tables: SnmpProfileTable[]; // carried through edit/clone (walked tables, e.g. disks)
}

const emptyEdit = (): EditState => ({ id: null, name: "", vendor: "", deviceType: "generic", model: "", standard: true, oids: [], tables: [] });

/** enum map ⇄ "raw=label,raw=label" text for the column editor. */
const enumToStr = (e?: Record<string, string>): string => (e ? Object.entries(e).map(([k, v]) => `${k}=${v}`).join(",") : "");
function strToEnum(s: string): Record<string, string> | undefined {
  const o: Record<string, string> = {};
  for (const part of s.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k && v) o[k] = v;
  }
  return Object.keys(o).length ? o : undefined;
}

function fromDTO(p: SnmpProfileDTO): EditState {
  return { id: p.id, name: p.name, vendor: p.vendor, deviceType: p.deviceType, model: p.model, standard: p.standard, oids: p.oids.map((o) => ({ ...o })), tables: (p.tables ?? []).map((t) => ({ ...t, columns: t.columns.map((c) => ({ ...c })) })) };
}

function toInput(e: EditState): SnmpProfileInput {
  return {
    name: e.name,
    vendor: e.vendor,
    deviceType: e.deviceType,
    model: e.model,
    standard: e.standard,
    oids: e.oids.filter((o) => o.oid.trim()).map((o) => ({ label: o.label.trim() || o.oid.trim(), oid: o.oid.trim(), unit: o.unit?.trim() || undefined, group: o.group?.trim() || undefined })),
    tables: e.tables,
  };
}

export function SnmpProfilesPage() {
  const { has } = useAuth();
  const confirm = useConfirm();
  const { loading, error, profiles, create, update, remove } = useSnmpProfiles();
  const canWrite = has("monitors:write");

  const [edit, setEdit] = useState<EditState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // "Browse device" — walk a real device's MIB to discover OIDs for the profile.
  const [walk, setWalk] = useState({ host: "", community: "public", oid: "1.3.6.1.2.1", busy: false });
  const [walkRows, setWalkRows] = useState<Array<{ oid: string; name: string; value: string }>>([]);
  const [walkFilter, setWalkFilter] = useState("");

  async function runWalk() {
    if (!edit || !walk.host.trim()) return;
    setWalk((w) => ({ ...w, busy: true }));
    setActionError(null);
    try {
      const r = await api.post<{ ok: boolean; rows: Array<{ oid: string; name: string; value: string }>; error?: string }>("/api/snmp/walk", {
        host: walk.host.trim(), community: walk.community || "public", oid: walk.oid.trim() || "1.3.6.1.2.1",
      });
      setWalkRows(r.rows);
      if (!r.ok && r.rows.length === 0) setActionError(`Walk returned nothing${r.error ? ` (${r.error})` : ""}. Check host, community, and that SNMP is allowed.`);
    } catch {
      setActionError("Walk failed.");
    } finally {
      setWalk((w) => ({ ...w, busy: false }));
    }
  }

  function addWalkOid(row: { oid: string; name: string; value: string }) {
    if (!edit || edit.oids.some((o) => o.oid === row.oid)) return;
    setEdit({ ...edit, oids: [...edit.oids, { label: row.name || `OID ${row.oid.split(".").slice(-2).join(".")}`, oid: row.oid }] });
  }

  function cloneProfile(p: SnmpProfileDTO) {
    setEdit({ ...fromDTO(p), id: null, name: `${p.name} copy` });
  }

  // MIB files (OID-name master) — uploading resolves numeric OIDs to names in browse.
  const [mibs, setMibs] = useState<Array<{ mib: string; count: number }>>([]);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const loadMibs = () => void api.get<{ rows: Array<{ mib: string; count: number }> }>("/api/snmp/mibs").then((r) => setMibs(r.rows), () => {});
  useEffect(() => { loadMibs(); }, []);

  function onImportMib() {
    if (!canWrite) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mib,.txt,text/plain";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then(async (content) => {
        setActionError(null);
        setActionNote(null);
        try {
          const r = await api.post<{ imported: number; parsed: number }>("/api/snmp/mibs", { name: file.name.replace(/\.[^.]+$/, ""), content });
          setActionNote(`Imported ${r.imported} named OIDs from ${file.name} (parsed ${r.parsed}).`);
          loadMibs();
        } catch {
          setActionError("MIB import failed — is it a valid .mib/.txt module?");
        }
      });
    };
    input.click();
  }

  async function removeMib(name: string) {
    if (!(await confirm({ title: "Remove MIB", message: `Remove imported MIB "${name}"? Its OID names will no longer resolve.`, confirmLabel: "Remove" }))) return;
    await api.del(`/api/snmp/mibs/${encodeURIComponent(name)}`);
    loadMibs();
  }

  function exportProfile(p: SnmpProfileDTO) {
    const data = JSON.stringify({ name: p.name, vendor: p.vendor, deviceType: p.deviceType, model: p.model, standard: p.standard, oids: p.oids, tables: p.tables }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `snmp-profile-${p.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function onImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        try {
          const j = JSON.parse(text) as Partial<SnmpProfileDTO>;
          setEdit({
            id: null,
            name: `${String(j.name ?? "Imported profile")} (imported)`,
            vendor: String(j.vendor ?? ""),
            deviceType: String(j.deviceType ?? "generic"),
            model: String(j.model ?? ""),
            standard: j.standard !== false,
            oids: Array.isArray(j.oids) ? j.oids.map((o) => ({ label: String(o.label ?? ""), oid: String(o.oid ?? ""), unit: o.unit, group: o.group })) : [],
            tables: Array.isArray(j.tables) ? (j.tables as SnmpProfileTable[]) : [],
          });
        } catch {
          setActionError("That file isn't a valid profile JSON.");
        }
      });
    };
    input.click();
  }

  async function save() {
    if (!edit || !edit.name.trim()) return;
    setActionError(null);
    try {
      if (edit.id) await update(edit.id, toInput(edit));
      else await create(toInput(edit));
      setEdit(null);
    } catch {
      setActionError("Save failed (system profiles are read-only — clone to customize).");
    }
  }

  if (loading) return <Spinner label="Loading SNMP profiles…" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">SNMP profiles</h1>
          <p className="text-sm text-slate-500">The MIB master — curated OID sets by vendor / device type / model. An SNMP monitor picks a profile.</p>
        </div>
        {canWrite ? (
          <div className="flex gap-2">
            <button type="button" onClick={onImport} className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-slate-500">Import JSON</button>
            <button type="button" onClick={() => setEdit(emptyEdit())} className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400">New profile</button>
          </div>
        ) : null}
      </div>

      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}
      {actionError ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{actionError}</div> : null}
      {actionNote ? <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{actionNote}</div> : null}

      {/* MIB files — uploading resolves numeric OIDs to friendly names in Browse */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">MIB files</h2>
            <p className="text-xs text-slate-500">Upload a vendor .mib (e.g. QNAP NAS.mib) so Browse shows real OID names — search “temp/fan/disk” works after import.</p>
          </div>
          {canWrite ? <button type="button" onClick={onImportMib} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-500">Import MIB</button> : null}
        </div>
        {mibs.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {mibs.map((m) => (
              <span key={m.mib} className="inline-flex items-center gap-2 rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300">
                {m.mib} <span className="text-slate-500">{m.count}</span>
                {canWrite ? <button type="button" onClick={() => void removeMib(m.mib)} className="text-slate-500 hover:text-rose-300" title="Remove">✕</button> : null}
              </span>
            ))}
          </div>
        ) : <p className="mt-2 text-xs text-slate-600">No MIBs imported yet.</p>}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Model</th>
              <th className="px-4 py-3 font-medium">Standard</th>
              <th className="px-4 py-3 font-medium">OIDs</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {profiles.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-slate-500">No profiles.</td></tr>
            ) : profiles.map((p) => (
              <tr key={p.id} className="text-slate-200">
                <td className="px-4 py-3">{p.name}{p.isSystem ? <span className="ml-2 rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">built-in</span> : null}</td>
                <td className="px-4 py-3 text-slate-400">{p.vendor || "—"}</td>
                <td className="px-4 py-3 text-slate-400">{p.deviceType}</td>
                <td className="px-4 py-3 text-slate-400">{p.model || "—"}</td>
                <td className="px-4 py-3 text-slate-400">{p.standard ? "yes" : "no"}</td>
                <td className="px-4 py-3 tabular-nums text-slate-400">{p.oids.length}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => exportProfile(p)} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500">Export</button>
                    {canWrite ? <button type="button" onClick={() => cloneProfile(p)} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500">Clone</button> : null}
                    {canWrite ? <button type="button" onClick={() => setEdit(fromDTO(p))} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500">{p.isSystem ? "View" : "Edit"}</button> : null}
                    {canWrite && !p.isSystem ? (
                      <button
                        type="button"
                        onClick={() => void (async () => { if (await confirm({ title: "Delete profile", message: `Delete "${p.name}"?`, confirmLabel: "Delete" })) await remove(p.id); })()}
                        className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {edit ? (
        <Modal title={edit.id ? "Edit profile" : "New profile"} onClose={() => setEdit(null)}>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Name</span><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={inputCls} /></label>
              <label className="block"><span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Vendor</span><input value={edit.vendor} onChange={(e) => setEdit({ ...edit, vendor: e.target.value })} placeholder="QNAP" className={inputCls} /></label>
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Device type</span>
                <select value={edit.deviceType} onChange={(e) => setEdit({ ...edit, deviceType: e.target.value })} className={inputCls}>
                  {SNMP_DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="block"><span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Model</span><input value={edit.model} onChange={(e) => setEdit({ ...edit, model: e.target.value })} placeholder="TS-453D" className={inputCls} /></label>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={edit.standard} onChange={(e) => setEdit({ ...edit, standard: e.target.checked })} className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-sky-500" />
              Collect standard health (HOST-RESOURCES + IF-MIB: uptime, CPU, memory, volumes, interfaces)
            </label>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-slate-500">Custom OIDs</span>
                <button type="button" onClick={() => setEdit({ ...edit, oids: [...edit.oids, { label: "", oid: "" }] })} className="rounded-md border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:border-slate-500">+ Add OID</button>
              </div>
              <div className="space-y-2">
                {edit.oids.length === 0 ? <p className="text-xs text-slate-600">No custom OIDs — standard health only.</p> : null}
                {edit.oids.map((o, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input value={o.label} onChange={(e) => { const oids = [...edit.oids]; oids[i] = { ...o, label: e.target.value }; setEdit({ ...edit, oids }); }} placeholder="Label" className={`${inputCls} w-40`} />
                    <input value={o.oid} onChange={(e) => { const oids = [...edit.oids]; oids[i] = { ...o, oid: e.target.value }; setEdit({ ...edit, oids }); }} placeholder="1.3.6.1.4.1…" className={`${inputCls} flex-1 font-mono text-xs`} />
                    <input value={o.unit ?? ""} onChange={(e) => { const oids = [...edit.oids]; oids[i] = { ...o, unit: e.target.value }; setEdit({ ...edit, oids }); }} placeholder="unit" className={`${inputCls} w-20`} />
                    <input value={o.group ?? ""} onChange={(e) => { const oids = [...edit.oids]; oids[i] = { ...o, group: e.target.value }; setEdit({ ...edit, oids }); }} placeholder="group" className={`${inputCls} w-24`} />
                    <button type="button" onClick={() => setEdit({ ...edit, oids: edit.oids.filter((_, j) => j !== i) })} className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500">✕</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Tables editor — walked SNMP tables rendered as per-row grids (e.g. disks) */}
            <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-slate-500">Tables (walked → per-row grids)</span>
                <button type="button" onClick={() => setEdit({ ...edit, tables: [...edit.tables, { name: "Table", oid: "", columns: [] }] })} className="rounded-md border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:border-slate-500">+ Add table</button>
              </div>
              {edit.tables.length === 0 ? <p className="text-xs text-slate-600">No tables. Add one (entry OID + columns) to render per-row data like disks.</p> : null}
              <div className="space-y-3">
                {edit.tables.map((t, ti) => {
                  const setT = (patch: Partial<SnmpProfileTable>) => { const tables = [...edit.tables]; tables[ti] = { ...t, ...patch }; setEdit({ ...edit, tables }); };
                  const setCol = (ci: number, patch: Partial<SnmpProfileTable["columns"][number]>) => { const cols = t.columns.map((c, j) => (j === ci ? { ...c, ...patch } : c)); setT({ columns: cols }); };
                  return (
                    <div key={ti} className="rounded border border-slate-800 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <input value={t.name} onChange={(e) => setT({ name: e.target.value })} placeholder="Table name" className={`${inputCls} w-36`} />
                        <input value={t.oid} onChange={(e) => setT({ oid: e.target.value })} placeholder="entry OID e.g. 1.3.6.1.4.1.55062.2.10.1.1" className={`${inputCls} flex-1 font-mono text-xs`} />
                        <button type="button" onClick={() => setEdit({ ...edit, tables: edit.tables.filter((_, j) => j !== ti) })} className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500">Remove</button>
                      </div>
                      <div className="mt-2 space-y-1">
                        {t.columns.map((c, ci) => (
                          <div key={ci} className="flex flex-wrap items-center gap-1.5">
                            <input value={c.label} onChange={(e) => setCol(ci, { label: e.target.value })} placeholder="Column" className={`${inputCls} w-28`} />
                            <input type="number" value={c.col} onChange={(e) => setCol(ci, { col: Number(e.target.value) })} placeholder="#" className={`${inputCls} w-14`} title="column number" />
                            <select value={c.unit ?? ""} onChange={(e) => setCol(ci, { unit: e.target.value || undefined })} className={`${inputCls} w-24`}>
                              <option value="">unit —</option><option value="bytes">bytes</option><option value="°C">°C</option><option value="%">%</option><option value="RPM">RPM</option>
                            </select>
                            <input value={enumToStr(c.enum)} onChange={(e) => setCol(ci, { enum: strToEnum(e.target.value) })} placeholder="enum 0=ready,-1=warning" className={`${inputCls} flex-1 text-xs`} />
                            <button type="button" onClick={() => setT({ columns: t.columns.filter((_, j) => j !== ci) })} className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400">✕</button>
                          </div>
                        ))}
                        <button type="button" onClick={() => setT({ columns: [...t.columns, { label: "", col: 1 }] })} className="rounded-md border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:border-slate-500">+ Add column</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {canWrite ? (
              <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
                <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Browse device — discover OIDs from a live device</div>
                <div className="flex flex-wrap items-end gap-2">
                  <input value={walk.host} onChange={(e) => setWalk({ ...walk, host: e.target.value })} placeholder="device host / IP" className={`${inputCls} w-44`} />
                  <input value={walk.community} onChange={(e) => setWalk({ ...walk, community: e.target.value })} placeholder="community" className={`${inputCls} w-28`} />
                  <input value={walk.oid} onChange={(e) => setWalk({ ...walk, oid: e.target.value })} placeholder="base OID" className={`${inputCls} w-44 font-mono text-xs`} title="e.g. 1.3.6.1.2.1 (standard) or 1.3.6.1.4.1.55062 (QNAP QuTS hero)" />
                  <button type="button" onClick={() => void runWalk()} disabled={walk.busy || !walk.host.trim()} className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-60">{walk.busy ? "Walking…" : "Walk"}</button>
                </div>
                {walkRows.length > 0 ? (
                  <div className="mt-2">
                    <input value={walkFilter} onChange={(e) => setWalkFilter(e.target.value)} placeholder={`Filter ${walkRows.length} results…`} className={`${inputCls} mb-2`} />
                    <div className="max-h-60 overflow-auto rounded-md border border-slate-800">
                      <table className="w-full text-left text-xs">
                        <tbody className="divide-y divide-slate-800">
                          {walkRows
                            .filter((r) => {
                              const f = walkFilter.toLowerCase();
                              return !f || r.oid.includes(walkFilter) || r.value.toLowerCase().includes(f) || r.name.toLowerCase().includes(f);
                            })
                            .slice(0, 300)
                            .map((r) => (
                              <tr key={r.oid} className="text-slate-300">
                                <td className="px-2 py-1">
                                  <div className={r.name ? "text-slate-200" : "text-slate-500"}>{r.name || "(unnamed)"}</div>
                                  <div className="font-mono text-[0.66rem] text-slate-600">{r.oid}</div>
                                </td>
                                <td className="px-2 py-1 font-mono text-slate-200">{r.value || "—"}</td>
                                <td className="px-2 py-1 text-right">
                                  <button type="button" onClick={() => addWalkOid(r)} className="rounded border border-slate-700 px-2 py-0.5 text-[0.7rem] text-slate-300 hover:border-slate-500">Add</button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-1 text-[0.7rem] text-slate-500">Named rows are searchable (temp/cpu/fan/disk/interface). Click Add, then set label/unit/group above. For QuTS hero also try base OID 1.3.6.1.4.1.55062.</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEdit(null)} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500">Close</button>
              {canWrite ? <button type="button" onClick={() => void save()} className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500">Save</button> : null}
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
