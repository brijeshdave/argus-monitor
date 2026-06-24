/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Dedicated user create/edit page (replaces the modals). Edits the profile, the
 * disabled flag and an optional password reset, manages group membership and ABAC
 * attributes, and shows a live preview of the user's EFFECTIVE permissions (the
 * union across their groups' roles). Access is granted ONLY via groups. Protected
 * (owner/system) users are read-only.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Attribute } from "@argus/shared";
import { useUsers, type CreateUserInput, type UpdateUserInput } from "@/hooks/useUsers";
import { useAuth } from "@/auth/AuthContext";
import { Spinner } from "@/components/Spinner";
import { ChipMultiSelect } from "@/components/ChipMultiSelect";
import { EffectivePermissions } from "@/components/EffectivePermissions";

const inputCls = "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";
const btnGhost = "rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500";
const card = "rounded-lg border border-slate-800 bg-slate-900/40 p-4 sm:p-5";
const sectionLabel = "mb-3 text-sm font-semibold text-slate-200";

export function UserEditorPage() {
  const { id } = useParams<{ id: string }>();
  const editing = !!id;
  const navigate = useNavigate();
  const { has } = useAuth();
  const canWrite = has("users:write");
  const { loading, users, groups, roles, createUser, updateUser, setUserGroups, setUserAttributes } = useUsers();

  const existing = useMemo(() => (editing ? users.find((u) => u.id === id) : undefined), [editing, users, id]);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [hydrated, setHydrated] = useState(!editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing && !hydrated && existing) {
      setUsername(existing.username);
      setDisplayName(existing.displayName ?? "");
      setEmail(existing.email ?? "");
      setDisabled(existing.disabled);
      setGroupIds(existing.groupIds);
      setAttributes(existing.attributes ?? []);
      setHydrated(true);
    }
  }, [editing, hydrated, existing]);

  // Effective permissions: union of the permissions carried by the roles of the
  // currently-selected groups. Updates live as groups are toggled.
  const effectiveKeys = useMemo(() => {
    const roleIds = new Set<string>();
    for (const gid of groupIds) groups.find((g) => g.id === gid)?.roleIds.forEach((r) => roleIds.add(r));
    const keys = new Set<string>();
    for (const rid of roleIds) roles.find((r) => r.id === rid)?.permissions.forEach((k) => keys.add(k));
    return [...keys];
  }, [groupIds, groups, roles]);

  if (loading || !hydrated) return <Spinner label="Loading user…" />;

  const locked = (existing?.isOwner || existing?.isSystem) ?? false;
  const formDisabled = locked || !canWrite;

  const setAttr = (i: number, patch: Partial<Attribute>) =>
    setAttributes((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const addAttr = () => setAttributes((prev) => [...prev, { key: "", value: "" }]);
  const removeAttr = (i: number) => setAttributes((prev) => prev.filter((_, idx) => idx !== i));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (formDisabled) return;
    if (!editing && (!username.trim() || !password)) return;
    const cleanedAttrs = attributes.filter((a) => a.key.trim());
    setSaving(true);
    setError(null);
    try {
      if (editing && id) {
        const patch: UpdateUserInput = { displayName: displayName.trim(), email: email.trim(), disabled };
        if (password) patch.password = password;
        await updateUser(id, patch);
        await setUserGroups(id, groupIds);
        await setUserAttributes(id, cleanedAttrs);
      } else {
        const input: CreateUserInput = {
          username: username.trim(),
          password,
          displayName: displayName.trim() || undefined,
          email: email.trim() || undefined,
          groupIds: groupIds.length ? groupIds : undefined,
          attributes: cleanedAttrs.length ? cleanedAttrs : undefined,
        };
        await createUser(input);
      }
      navigate("/admin/users");
    } catch {
      setError("Failed to save the user.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">{editing ? `Edit user${existing ? ` — ${existing.username}` : ""}` : "New user"}</h1>
        <div className="flex gap-2">
          {editing && id ? <button type="button" onClick={() => navigate(`/admin/users/${id}/sessions`)} className={btnGhost}>Sessions</button> : null}
          <button type="button" onClick={() => navigate("/admin/users")} className={btnGhost}>← Back</button>
        </div>
      </div>

      {locked ? (
        <div className="rounded-md border border-slate-700 bg-slate-800/40 px-4 py-3 text-sm text-slate-300">This is a protected account — it cannot be edited.</div>
      ) : null}
      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}

      <form onSubmit={onSubmit} className="grid items-start gap-6 xl:grid-cols-3">
        {/* Left: the editable form (two of three columns on wide screens). */}
        <div className="space-y-6 xl:col-span-2">
          <section className={card}>
            <h2 className={sectionLabel}>Profile</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Username</span>
                <input className={inputCls} value={username} disabled={editing || formDisabled} onChange={(e) => setUsername(e.target.value)} autoFocus={!editing} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Display name</span>
                <input className={inputCls} value={displayName} disabled={formDisabled} onChange={(e) => setDisplayName(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Email</span>
                <input type="email" className={inputCls} value={email} disabled={formDisabled} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">{editing ? "Reset password (blank = keep)" : "Password"}</span>
                <input type="password" className={inputCls} value={password} disabled={formDisabled} onChange={(e) => setPassword(e.target.value)} />
              </label>
            </div>
            {editing ? (
              <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={disabled} disabled={formDisabled} onChange={(e) => setDisabled(e.target.checked)} className="h-4 w-4 accent-sky-500" />
                Disable this account
              </label>
            ) : null}
          </section>

          <section className={card}>
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Groups</h2>
              <span className="text-xs text-slate-500">{groupIds.length} selected</span>
            </div>
            <p className="mb-3 text-xs text-slate-500">Access is granted only through groups. This user gets every permission carried by the roles of the selected groups.</p>
            <ChipMultiSelect options={groups} selected={groupIds} onChange={setGroupIds} disabled={formDisabled} emptyNote="No groups available." />
          </section>

          <section className={card}>
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Attributes (ABAC)</h2>
              <span className="text-xs text-slate-500">{attributes.filter((a) => a.key.trim()).length} set</span>
            </div>
            <p className="mb-3 text-xs text-slate-500">Optional key/value pairs that refine access scope (e.g. <span className="font-mono">site = plant-a</span>, <span className="font-mono">tag = prod</span>).</p>
            <div className="space-y-2">
              {attributes.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={inputCls} placeholder="key (e.g. site)" value={a.key} disabled={formDisabled} onChange={(e) => setAttr(i, { key: e.target.value })} />
                  <span className="text-slate-500">=</span>
                  <input className={inputCls} placeholder="value (e.g. plant-a)" value={a.value} disabled={formDisabled} onChange={(e) => setAttr(i, { value: e.target.value })} />
                  <button type="button" disabled={formDisabled} onClick={() => removeAttr(i)} className="shrink-0 rounded-md border border-rose-600/50 px-2.5 py-2 text-xs text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-40">Remove</button>
                </div>
              ))}
              <button type="button" disabled={formDisabled} onClick={addAttr} className={`${btnGhost} disabled:opacity-40`}>+ Add attribute</button>
            </div>
          </section>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={formDisabled || saving || (!editing && (!username.trim() || !password))} className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? "Saving…" : editing ? "Save changes" : "Create user"}
            </button>
            <button type="button" onClick={() => navigate("/admin/users")} className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-slate-500">Cancel</button>
          </div>
        </div>

        {/* Right: live effective-permissions preview (sticky on wide screens). */}
        <aside className="space-y-6 xl:sticky xl:top-6">
          <section className={card}>
            <h2 className={sectionLabel}>Effective permissions</h2>
            <p className="mb-3 text-xs text-slate-500">What this user can actually do, computed from the selected groups' roles.</p>
            <EffectivePermissions keys={effectiveKeys} isOwner={existing?.isOwner} />
          </section>
        </aside>
      </form>
    </div>
  );
}
