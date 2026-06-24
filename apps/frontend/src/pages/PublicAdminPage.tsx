/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Public status-page admin: toggle the page on/off, set its title/description and
 * uptime/history display, and curate the list of pinned items (agents/monitors)
 * with custom labels, custom group names and ordering. Operators choose what the
 * world sees; only coarse status is ever exposed publicly.
 * Read requires `public:read`; saving requires `public:write`.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { PUBLIC_HISTORY_DAYS, type PublicConfigDTO, type PublicItemConfig } from "@argus/shared";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useAuth } from "@/auth/AuthContext";
import { Spinner } from "@/components/Spinner";

const inputCls =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";

export function PublicAdminPage() {
  const { has } = useAuth();
  const { loading, error, config, agents, monitors, save } = usePublicConfig();

  const canRead = has("public:read");
  const canWrite = has("public:write");

  // Local editable draft, hydrated from the loaded config.
  const [draft, setDraft] = useState<PublicConfigDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) setDraft(config);
  }, [config]);

  // Add-item picker state.
  const [pickKind, setPickKind] = useState<"agent" | "monitor">("agent");
  const [pickRef, setPickRef] = useState<string>("");

  const options = useMemo(
    () =>
      pickKind === "agent"
        ? agents.map((a) => ({ refId: a.id, label: a.name }))
        : monitors.map((m) => ({ refId: m.id, label: m.name })),
    [pickKind, agents, monitors],
  );

  // Distinct group names already in use — offered as autocomplete suggestions.
  const groupNames = useMemo(() => {
    const set = new Set<string>();
    for (const it of draft?.items ?? []) if (it.group?.trim()) set.add(it.group.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [draft]);

  if (loading || !draft) return <Spinner label="Loading public status…" />;

  if (!canRead) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
        You do not have permission to view the public status configuration.
      </div>
    );
  }

  function patch(next: Partial<PublicConfigDTO>) {
    setDraft((d) => (d ? { ...d, ...next } : d));
    setSaved(false);
  }

  function updateItem(index: number, next: Partial<PublicItemConfig>) {
    setDraft((d) => {
      if (!d) return d;
      const items = d.items.map((it, i) => (i === index ? { ...it, ...next } : it));
      return { ...d, items };
    });
    setSaved(false);
  }

  function removeItem(index: number) {
    setDraft((d) => (d ? { ...d, items: d.items.filter((_, i) => i !== index) } : d));
    setSaved(false);
  }

  function moveItem(index: number, dir: -1 | 1) {
    setDraft((d) => {
      if (!d) return d;
      const j = index + dir;
      if (j < 0 || j >= d.items.length) return d;
      const items = [...d.items];
      [items[index], items[j]] = [items[j]!, items[index]!];
      return { ...d, items };
    });
    setSaved(false);
  }

  function addItem() {
    if (!pickRef) return;
    const opt = options.find((o) => o.refId === pickRef);
    if (!opt) return;
    setDraft((d) =>
      d ? { ...d, items: [...d.items, { kind: pickKind, refId: opt.refId, label: opt.label }] } : d,
    );
    setPickRef("");
    setSaved(false);
  }

  async function onSave() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await save(draft);
      setSaved(true);
    } catch {
      setSaveError("Failed to save configuration.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Public Status</h1>
        <Link to="/status" target="_blank" rel="noreferrer" className="text-sm text-sky-300 hover:text-sky-200">
          Open public page ↗
        </Link>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      ) : null}

      {/* Page-level settings */}
      <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Appearance</h2>

        <label className="flex items-center gap-3 text-sm text-slate-200">
          <input type="checkbox" checked={draft.enabled} disabled={!canWrite} onChange={(e) => patch({ enabled: e.target.checked })} />
          Enable public status page
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Title</label>
            <input type="text" value={draft.title} disabled={!canWrite} onChange={(e) => patch({ title: e.target.value })} className={`${inputCls} disabled:opacity-60`} />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">History window</label>
            <select
              value={draft.historyDays}
              disabled={!canWrite || !draft.showHistory}
              onChange={(e) => patch({ historyDays: Number(e.target.value) })}
              className={`${inputCls} disabled:opacity-60`}
            >
              {PUBLIC_HISTORY_DAYS.map((d) => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Description (optional)</label>
          <textarea
            value={draft.description ?? ""}
            disabled={!canWrite}
            onChange={(e) => patch({ description: e.target.value })}
            rows={2}
            placeholder="A short blurb shown under the title — e.g. “Live status of our customer-facing services.”"
            className={`${inputCls} resize-y disabled:opacity-60`}
          />
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-3 text-sm text-slate-200">
            <input type="checkbox" checked={draft.showUptime} disabled={!canWrite} onChange={(e) => patch({ showUptime: e.target.checked })} />
            Show uptime percentage
          </label>
          <label className="flex items-center gap-3 text-sm text-slate-200">
            <input type="checkbox" checked={draft.showHistory} disabled={!canWrite} onChange={(e) => patch({ showHistory: e.target.checked })} />
            Show uptime history graph
          </label>
        </div>
      </section>

      {/* Notice / banner */}
      <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Banner</h2>
          <p className="mt-1 text-xs text-slate-500">
            Pin a message atop the public page — e.g. an active incident or scheduled maintenance window. Leave the message blank to hide it.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Type</span>
            <select
              value={draft.notice?.level ?? "info"}
              disabled={!canWrite}
              onChange={(e) => patch({ notice: { level: e.target.value as "info" | "maintenance" | "incident", message: draft.notice?.message ?? "" } })}
              className={`${inputCls} disabled:opacity-60`}
            >
              <option value="info">Info</option>
              <option value="maintenance">Maintenance</option>
              <option value="incident">Incident</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Message (blank = no banner)</span>
            <textarea
              value={draft.notice?.message ?? ""}
              disabled={!canWrite}
              onChange={(e) => patch({ notice: { level: draft.notice?.level ?? "info", message: e.target.value } })}
              rows={2}
              placeholder="e.g. Investigating elevated error rates — updates to follow."
              className={`${inputCls} resize-y disabled:opacity-60`}
            />
          </label>
        </div>
      </section>

      {/* Items */}
      <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Displayed components</h2>
          <p className="mt-1 text-xs text-slate-500">
            Rename freely, assign a group to bundle related components under a heading, and reorder with the arrows.
          </p>
        </div>

        {draft.items.length === 0 ? (
          <div className="text-sm text-slate-500">No components yet. Add an agent or monitor below.</div>
        ) : (
          <ul className="space-y-2">
            {draft.items.map((item, i) => (
              <li
                key={`${item.kind}:${item.refId}:${i}`}
                className="grid items-center gap-2 rounded-md border border-slate-800 bg-slate-950/40 p-2 sm:grid-cols-[5rem_1fr_12rem_auto]"
              >
                <span className="px-1 text-[10px] uppercase tracking-wide text-slate-500">{item.kind}</span>
                <input
                  type="text"
                  value={item.label}
                  disabled={!canWrite}
                  placeholder="Display name"
                  onChange={(e) => updateItem(i, { label: e.target.value })}
                  className={`${inputCls} disabled:opacity-60`}
                />
                <input
                  type="text"
                  value={item.group ?? ""}
                  disabled={!canWrite}
                  placeholder="Group (optional)"
                  list="public-group-names"
                  onChange={(e) => updateItem(i, { group: e.target.value })}
                  className={`${inputCls} disabled:opacity-60`}
                />
                {canWrite ? (
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0} title="Move up" className="rounded-md border border-slate-700 p-2 text-slate-300 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-30">
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" onClick={() => moveItem(i, 1)} disabled={i === draft.items.length - 1} title="Move down" className="rounded-md border border-slate-700 p-2 text-slate-300 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-30">
                      <ArrowDown size={14} />
                    </button>
                    <button type="button" onClick={() => removeItem(i)} title="Remove" className="rounded-md border border-slate-700 p-2 text-rose-300 transition-colors hover:border-rose-500">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <datalist id="public-group-names">
          {groupNames.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>

        {canWrite ? (
          <div className="grid items-end gap-3 border-t border-slate-800 pt-4 sm:grid-cols-[8rem_1fr_auto]">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Type</label>
              <select
                value={pickKind}
                onChange={(e) => {
                  setPickKind(e.target.value as "agent" | "monitor");
                  setPickRef("");
                }}
                className={inputCls}
              >
                <option value="agent">Agent</option>
                <option value="monitor">Monitor</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Source</label>
              <select value={pickRef} onChange={(e) => setPickRef(e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                {options.map((o) => (
                  <option key={o.refId} value={o.refId}>{o.label}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={addItem}
              disabled={!pickRef}
              className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-colors hover:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Add component
            </button>
          </div>
        ) : null}
      </section>

      {saveError ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{saveError}</div>
      ) : null}

      {canWrite ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving}
            className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved ? <span className="text-sm text-emerald-300">Saved.</span> : null}
        </div>
      ) : null}
    </div>
  );
}
