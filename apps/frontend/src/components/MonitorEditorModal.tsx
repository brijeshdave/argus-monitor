/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Create/edit a monitor for ONE agent (or device), used from the agent detail page —
 * monitors are managed inside their agent, not a separate page. Reuses the shared
 * structured fields (storage/database/snmp) with a JSON fallback for simple types,
 * and the service/process discovery pick-list. "ping" is omitted: the reachability
 * ping is provisioned automatically and never added by hand.
 */
import { useEffect, useState, type FormEvent } from "react";
import { MONITOR_TYPES, type HostInventoryDTO, type InventoryItem, type MonitorDTO, type MonitorType } from "@argus/shared";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { MonitorCredFields } from "@/components/MonitorCredFields";
import { buildConfig, emptyValues, validate, valuesFromConfig, type MonitorFieldValues } from "@/lib/monitorForm";

const inputCls = "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";
const ADDABLE_TYPES = MONITOR_TYPES.filter((t) => t !== "ping"); // ping is auto-provisioned
const isStructured = (t: string): boolean =>
  t === "storage" || t === "database" || t === "snmp" || t === "http" || t === "tcp" || t === "dns" || t === "ping";

function parseConfig(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const parsed: unknown = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Config must be a JSON object.");
  return parsed as Record<string, unknown>;
}

export function MonitorEditorModal({
  agentId, agentKind = "agent", monitor, onClose, onSaved,
}: {
  agentId: string;
  agentKind?: string;
  monitor?: MonitorDTO | null; // null/undefined → create
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!monitor;
  // Agentless devices have no agent to run agent-side collectors — only the
  // server-side SNMP type works there (ping is auto-provisioned).
  const isDevice = agentKind === "device";
  // On a device: server-side checks only (no agent to run agent-side collectors) —
  // SNMP, SMB storage probe, and the agentless synthetic checks (http/tcp/dns).
  const typeChoices = isDevice ? (["http", "tcp", "dns", "snmp", "storage"] as MonitorType[]) : ADDABLE_TYPES;
  const [type, setType] = useState<MonitorType>(monitor?.type as MonitorType ?? typeChoices[0]!);
  const [name, setName] = useState(monitor?.name ?? "");
  const [enabled, setEnabled] = useState(monitor?.enabled ?? true);
  const [values, setValues] = useState<MonitorFieldValues>(
    monitor ? valuesFromConfig(monitor.type, monitor.config) : emptyValues(),
  );
  const [json, setJson] = useState(monitor && !isStructured(monitor.type) ? JSON.stringify(monitor.config ?? {}, null, 2) : "{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const structured = isStructured(type);
  const showPicker = !editing && (type === "service" || type === "process");

  // Discovery pick-list for service/process (create only).
  const [inventory, setInventory] = useState<HostInventoryDTO | null>(null);
  useEffect(() => {
    if (!showPicker) { setInventory(null); return; }
    let cancelled = false;
    void api.get<{ inventory: HostInventoryDTO }>(`/api/agents/${agentId}/inventory`)
      .then((r) => !cancelled && setInventory(r.inventory), () => !cancelled && setInventory(null));
    return () => { cancelled = true; };
  }, [showPicker, agentId, type]);

  function applyPick(item: InventoryItem) {
    setName(item.name);
    setJson(JSON.stringify({ match: item.name }, null, 2));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    let config: Record<string, unknown>;
    if (structured) {
      const err = validate(type, values);
      if (err) return setError(err);
      // On an agentless device, storage must be probed server-side (no agent to walk it).
      const v = isDevice && type === "storage" ? { ...values, server: true } : values;
      config = buildConfig(type, v);
      // Preserve a ping monitor's server/default flags (the form doesn't track them).
      if (type === "ping" && monitor) config = { ...(monitor.config as Record<string, unknown>), ...config };
    } else {
      try { config = parseConfig(json); } catch (err) { return setError(err instanceof Error ? err.message : "Invalid JSON config."); }
    }
    setBusy(true);
    setError(null);
    try {
      if (editing && monitor) await api.patch(`/api/monitors/${monitor.id}`, { name: name.trim(), enabled, config });
      else await api.post("/api/monitors", { agentId, type, name: name.trim(), enabled, config });
      onSaved();
      onClose();
    } catch {
      setError("Failed to save monitor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? `Edit ${type} monitor` : "Add monitor"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Type</span>
            {editing ? (
              <input value={type} disabled className={`${inputCls} opacity-60`} />
            ) : (
              <select value={type} onChange={(e) => setType(e.target.value as MonitorType)} className={inputCls}>
                {typeChoices.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </label>
        </div>

        {showPicker ? (
          <div>
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Discover {type}s</span>
            {(() => {
              const items = (type === "service" ? inventory?.services : inventory?.processes) ?? [];
              if (items.length === 0) return <p className="text-xs text-slate-500">Nothing discovered yet — type a match below (config) or pick after the agent reports.</p>;
              return (
                <select value="" onChange={(e) => { const it = items.find((i) => i.name === e.target.value); if (it) applyPick(it); }} className={inputCls}>
                  <option value="" disabled>Pick a {type}…</option>
                  {items.map((it) => <option key={it.name} value={it.name}>{it.name}{it.detail ? ` — ${it.detail}` : ""}</option>)}
                </select>
              );
            })()}
          </div>
        ) : null}

        {structured ? (
          <MonitorCredFields type={type} values={values} onChange={setValues} editing={editing} />
        ) : (
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Config (JSON)</span>
            <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={5} spellCheck={false} className={`${inputCls} font-mono text-xs`} />
          </label>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-sky-500" />
          Enabled
        </label>

        {isDevice && type === "storage" ? (
          <div className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
            Probed <b>from the Argus host</b> over SMB (no agent). Set the share path to <code>{"\\\\host\\share"}</code> and add watched folders — capacity + folder sizes are collected server-side every few minutes.
          </div>
        ) : null}
        {isDevice && type !== "snmp" && type !== "storage" ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            This is an agentless <b>device</b> — a “{type}” monitor needs an agent and won’t report here. Use SNMP or a server-side storage monitor, or add it on an agent host.
          </div>
        ) : null}
        {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div> : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500">Cancel</button>
          <button type="submit" disabled={busy || !name.trim()} className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
