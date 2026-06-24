/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Dedicated ticker create/edit page (replaces the cramped modal). Authors text,
 * severity, priority, enabled flag and an optional live window, with one-click
 * "Now" / "Clear" on the date-time fields, audience targeting (which wall
 * device-groups + which user-groups see it), and a live preview of the bar.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { TICKER_SEVERITIES, type TickerMessageDTO, type TickerSeverity, type WallDeviceGroupDTO } from "@argus/shared";
import { useTicker, type TickerInput } from "@/hooks/useTicker";
import { useAuth } from "@/auth/AuthContext";
import { api } from "@/lib/api";
import { Spinner } from "@/components/Spinner";

const inputCls = "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";
const btnGhost = "rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500";
const card = "rounded-lg border border-slate-800 bg-slate-900/40 p-4 sm:p-5";

interface GroupOpt { id: string; name: string }

/** ISO-8601 UTC → <input type="datetime-local"> value (local, no tz). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value → ISO-8601 UTC, or null when blank/invalid. */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "now" (optionally + minutes) as a datetime-local value. */
function nowLocal(plusMin = 0): string {
  return isoToLocalInput(new Date(Date.now() + plusMin * 60_000).toISOString());
}

const SEV_STYLE: Record<TickerSeverity, string> = {
  info: "bg-sky-500/15 text-sky-200 ring-sky-500/30",
  warning: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
  critical: "bg-rose-500/15 text-rose-200 ring-rose-500/30",
};

function emptyDraft(): TickerInput {
  return { text: "", severity: "info", priority: 0, enabled: true, startsAt: null, endsAt: null, deviceGroupIds: [], userGroupIds: [] };
}

function toDraft(m: TickerMessageDTO): TickerInput {
  return {
    text: m.text, severity: m.severity, priority: m.priority, enabled: m.enabled,
    startsAt: m.startsAt, endsAt: m.endsAt,
    deviceGroupIds: m.deviceGroupIds ?? [], userGroupIds: m.userGroupIds ?? [],
  };
}

/** A checkbox list for picking target groups (empty selection = everyone). */
function GroupPicker({ label, hint, options, selected, onChange, emptyNote }: {
  label: string; hint: string; options: GroupOpt[]; selected: string[];
  onChange: (ids: string[]) => void; emptyNote: string;
}) {
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
        <span className="text-xs text-slate-500">{selected.length === 0 ? "All" : `${selected.length} selected`}</span>
      </div>
      <p className="mb-2 text-xs text-slate-500">{hint}</p>
      {options.length === 0 ? (
        <p className="rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-600">{emptyNote}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => {
            const on = selected.includes(o.id);
            return (
              <button key={o.id} type="button" onClick={() => toggle(o.id)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${on ? "border-sky-500/50 bg-sky-500/15 text-sky-200" : "border-slate-700 text-slate-300 hover:border-slate-500"}`}>
                {on ? "✓ " : ""}{o.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TickerEditorPage() {
  const { id } = useParams<{ id: string }>();
  const editing = !!id;
  const navigate = useNavigate();
  const { has } = useAuth();
  const canWrite = has("ticker:write");
  const { messages, loading, create, update } = useTicker();

  const [draft, setDraft] = useState<TickerInput | null>(editing ? null : emptyDraft());
  const [deviceGroups, setDeviceGroups] = useState<GroupOpt[]>([]);
  const [userGroups, setUserGroups] = useState<GroupOpt[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate the draft from the loaded message when editing.
  useEffect(() => {
    if (editing && draft === null) {
      const m = messages.find((x) => x.id === id);
      if (m) setDraft(toDraft(m));
    }
  }, [editing, draft, messages, id]);

  // Load the group catalogues for the pickers (best-effort — needs read perms).
  useEffect(() => {
    void api.get<{ rows: WallDeviceGroupDTO[] }>("/api/device-groups")
      .then((r) => setDeviceGroups(r.rows.map((g) => ({ id: g.id, name: g.name }))), () => setDeviceGroups([]));
    void api.get<{ rows: Array<{ id: string; name: string }> }>("/api/groups")
      .then((r) => setUserGroups(r.rows.map((g) => ({ id: g.id, name: g.name }))), () => setUserGroups([]));
  }, []);

  const set = (patch: Partial<TickerInput>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const previewTone = useMemo(() => (draft ? SEV_STYLE[draft.severity] : SEV_STYLE.info), [draft]);

  if (loading || !draft) return <Spinner label="Loading ticker…" />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft || !draft.text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload: TickerInput = { ...draft, text: draft.text.trim() };
      if (editing && id) await update(id, payload);
      else await create(payload);
      navigate("/ticker");
    } catch {
      setError("Failed to save the ticker message.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">{editing ? "Edit ticker message" : "New ticker message"}</h1>
        <button type="button" onClick={() => navigate("/ticker")} className={btnGhost}>← Back</button>
      </div>

      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}

      <form onSubmit={onSubmit} className="grid items-start gap-6 xl:grid-cols-3">
        {/* Left: the editable form. */}
        <div className="space-y-6 xl:col-span-2">
          <section className={card}>
            <h2 className="mb-3 text-sm font-semibold text-slate-200">Message</h2>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Text</span>
              <textarea value={draft.text} onChange={(e) => set({ text: e.target.value })} rows={3} placeholder="e.g. Scheduled maintenance tonight 22:00–23:00" className={`${inputCls} resize-y`} />
            </label>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Severity</span>
                <select value={draft.severity} onChange={(e) => set({ severity: e.target.value as TickerSeverity })} className={inputCls}>
                  {TICKER_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Priority</span>
                <input type="number" value={draft.priority} onChange={(e) => set({ priority: Number(e.target.value) || 0 })} className={inputCls} />
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm text-slate-300">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4 accent-sky-500" />
                Enabled
              </label>
            </div>
          </section>

          <section className={card}>
            <h2 className="mb-3 text-sm font-semibold text-slate-200">Schedule</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {(["startsAt", "endsAt"] as const).map((field) => (
                <div key={field}>
                  <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">{field === "startsAt" ? "Starts at" : "Ends at"} (optional)</span>
                  <input type="datetime-local" value={isoToLocalInput(draft[field])} onChange={(e) => set({ [field]: localInputToIso(e.target.value) } as Partial<TickerInput>)} className={inputCls} />
                  <div className="mt-1.5 flex gap-2">
                    <button type="button" onClick={() => set({ [field]: new Date().toISOString() } as Partial<TickerInput>)} className={btnGhost}>Now</button>
                    {field === "endsAt" ? (
                      <>
                        <button type="button" onClick={() => set({ endsAt: localInputToIso(nowLocal(60)) })} className={btnGhost}>+1h</button>
                        <button type="button" onClick={() => set({ endsAt: localInputToIso(nowLocal(1440)) })} className={btnGhost}>+1d</button>
                      </>
                    ) : null}
                    <button type="button" onClick={() => set({ [field]: null } as Partial<TickerInput>)} className={btnGhost}>Clear</button>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">Leave the window blank to show the message immediately and indefinitely (while enabled).</p>
          </section>

          <section className={card}>
            <h2 className="mb-3 text-sm font-semibold text-slate-200">Audience</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <GroupPicker
                label="Show on wall device-groups"
                hint="Which wallboard screens display this. Leave empty for all walls."
                options={deviceGroups} selected={draft.deviceGroupIds} onChange={(ids) => set({ deviceGroupIds: ids })}
                emptyNote="No device groups (or no permission to read them) — shows on all walls."
              />
              <GroupPicker
                label="Show to user-groups"
                hint="Which operator user-groups see this in the app. Leave empty for all users."
                options={userGroups} selected={draft.userGroupIds} onChange={(ids) => set({ userGroupIds: ids })}
                emptyNote="No user groups (or no permission to read them) — shows to all users."
              />
            </div>
          </section>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={!canWrite || saving || !draft.text.trim()} className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? "Saving…" : editing ? "Save changes" : "Create message"}
            </button>
            <button type="button" onClick={() => navigate("/ticker")} className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-slate-500">Cancel</button>
          </div>
        </div>

        {/* Right: live preview (sticky on wide screens). */}
        <aside className="space-y-6 xl:sticky xl:top-6">
          <section className={card}>
            <h2 className="mb-3 text-sm font-semibold text-slate-200">Preview</h2>
            <div className={`flex items-center gap-3 overflow-hidden rounded-md px-4 py-2 text-sm ring-1 ${previewTone}`}>
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inherit">{draft.severity}</span>
              <span className="truncate">{draft.text.trim() || "Your ticker message will appear here…"}</span>
            </div>
          </section>
        </aside>
      </form>
    </div>
  );
}
