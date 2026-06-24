/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Dedicated role create/edit page (replaces the cramped modals). Edits the name +
 * description and assigns permissions through the tabbed PermissionPicker. System
 * roles are read-only. On create the permissions are sent with the role; on edit
 * the profile and permissions are saved together.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useRoles } from "@/hooks/useRoles";
import { useAuth } from "@/auth/AuthContext";
import { Spinner } from "@/components/Spinner";
import { PermissionPicker } from "@/components/PermissionPicker";

const inputCls = "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";
const btnGhost = "rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500";
const card = "rounded-lg border border-slate-800 bg-slate-900/40 p-4 sm:p-5";

export function RoleEditorPage() {
  const { id } = useParams<{ id: string }>();
  const editing = !!id;
  const [params] = useSearchParams();
  const cloneFrom = params.get("from"); // /admin/roles/new?from=<roleId> → clone
  const navigate = useNavigate();
  const { has } = useAuth();
  const canWrite = has("roles:write");
  const { loading, roles, permissions, createRole, updateRole, setRolePermissions } = useRoles();

  const existing = useMemo(() => (editing ? roles.find((r) => r.id === id) : undefined), [editing, roles, id]);
  const source = useMemo(() => (cloneFrom ? roles.find((r) => r.id === cloneFrom) : undefined), [cloneFrom, roles]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // New blank role hydrates immediately; edit + clone wait for their source row.
  const [hydrated, setHydrated] = useState(!editing && !cloneFrom);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from the loaded role once: the role itself (edit) or the source to
  // clone (new?from=…), copying its permissions into a fresh, editable role.
  useEffect(() => {
    if (hydrated) return;
    if (editing && existing) {
      setName(existing.name);
      setDescription(existing.description ?? "");
      setSelected(new Set(existing.permissions));
      setHydrated(true);
    } else if (cloneFrom && source) {
      setName(`Copy of ${source.name}`);
      setDescription(source.description ?? "");
      setSelected(new Set(source.permissions));
      setHydrated(true);
    }
  }, [hydrated, editing, existing, cloneFrom, source]);

  if (loading || !hydrated) return <Spinner label="Loading role…" />;

  const locked = existing?.isSystem || !canWrite;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || locked) return;
    setSaving(true);
    setError(null);
    try {
      const keys = [...selected];
      if (editing && id) {
        await updateRole(id, { name: name.trim(), description: description.trim() });
        await setRolePermissions(id, keys);
      } else {
        await createRole({ name: name.trim(), description: description.trim() || undefined, permissionKeys: keys });
      }
      navigate("/admin/roles");
    } catch {
      setError("Failed to save the role.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">{editing ? `Edit role${existing ? ` — ${existing.name}` : ""}` : cloneFrom ? `New role${source ? ` (from ${source.name})` : ""}` : "New role"}</h1>
        <button type="button" onClick={() => navigate("/admin/roles")} className={btnGhost}>← Back</button>
      </div>

      {existing?.isSystem ? (
        <div className="rounded-md border border-slate-700 bg-slate-800/40 px-4 py-3 text-sm text-slate-300">This is a protected system role — it cannot be edited.</div>
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
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Permissions</h2>
          <PermissionPicker permissions={permissions} selected={selected} onChange={setSelected} disabled={locked} />
        </section>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={locked || saving || !name.trim()} className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? "Saving…" : editing ? "Save changes" : "Create role"}
          </button>
          <button type="button" onClick={() => navigate("/admin/roles")} className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-slate-500">Cancel</button>
        </div>
      </form>
    </div>
  );
}
