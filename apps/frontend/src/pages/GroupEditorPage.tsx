/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Dedicated group create/edit page (replaces the modals). Groups are the only
 * bridge from users to roles, so this edits the name + description and assigns
 * roles in one place. System groups are read-only.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useGroups } from "@/hooks/useGroups";
import { useAuth } from "@/auth/AuthContext";
import { Spinner } from "@/components/Spinner";
import { ChipMultiSelect } from "@/components/ChipMultiSelect";

const inputCls = "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";
const btnGhost = "rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500";
const card = "rounded-lg border border-slate-800 bg-slate-900/40 p-4 sm:p-5";

export function GroupEditorPage() {
  const { id } = useParams<{ id: string }>();
  const editing = !!id;
  const navigate = useNavigate();
  const { has } = useAuth();
  const canWrite = has("groups:write");
  const { loading, groups, roles, createGroup, updateGroup, setGroupRoles } = useGroups();

  const existing = useMemo(() => (editing ? groups.find((g) => g.id === id) : undefined), [editing, groups, id]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(!editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing && !hydrated && existing) {
      setName(existing.name);
      setDescription(existing.description ?? "");
      setRoleIds(existing.roleIds);
      setHydrated(true);
    }
  }, [editing, hydrated, existing]);

  if (loading || !hydrated) return <Spinner label="Loading group…" />;

  const locked = existing?.isSystem || !canWrite;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || locked) return;
    setSaving(true);
    setError(null);
    try {
      if (editing && id) {
        await updateGroup(id, { name: name.trim(), description: description.trim() });
        await setGroupRoles(id, roleIds);
      } else {
        await createGroup({ name: name.trim(), description: description.trim() || undefined, roleIds });
      }
      navigate("/admin/groups");
    } catch {
      setError("Failed to save the group.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">{editing ? `Edit group${existing ? ` — ${existing.name}` : ""}` : "New group"}</h1>
        <button type="button" onClick={() => navigate("/admin/groups")} className={btnGhost}>← Back</button>
      </div>

      {existing?.isSystem ? (
        <div className="rounded-md border border-slate-700 bg-slate-800/40 px-4 py-3 text-sm text-slate-300">This is a protected system group — it cannot be edited.</div>
      ) : null}
      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}

      <form onSubmit={onSubmit} className="space-y-6">
        <section className={card}>
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Details</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:max-w-3xl">
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Name</span>
              <input className={inputCls} value={name} disabled={locked} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Description</span>
              <input className={inputCls} value={description} disabled={locked} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </div>
        </section>

        <section className={card}>
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Roles</h2>
            <span className="text-xs text-slate-500">{roleIds.length} selected</span>
          </div>
          <p className="mb-3 text-xs text-slate-500">Members of this group gain every permission carried by the selected roles.</p>
          <ChipMultiSelect options={roles} selected={roleIds} onChange={setRoleIds} disabled={locked} emptyNote="No roles available." />
        </section>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={locked || saving || !name.trim()} className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? "Saving…" : editing ? "Save changes" : "Create group"}
          </button>
          <button type="button" onClick={() => navigate("/admin/groups")} className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-slate-500">Cancel</button>
        </div>
      </form>
    </div>
  );
}
