/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Groups admin (list). Create/edit happen on a dedicated page (/admin/groups/new,
 * /admin/groups/:id/edit) — see GroupEditorPage. Groups are the only access-granting
 * bridge (users → groups → roles). Protected groups (isSystem) are read-only.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGroups } from "@/hooks/useGroups";
import { useAuth } from "@/auth/AuthContext";
import { useConfirm } from "@/components/ConfirmProvider";
import { Spinner } from "@/components/Spinner";

const primaryBtn = "rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60";
const rowBtn = "rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40";

function SystemTag() {
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-slate-700/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300 ring-1 ring-slate-600/50">
      system
    </span>
  );
}

export function GroupsPage() {
  const { has } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { loading, error, groups, roles, deleteGroup } = useGroups();
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  const canWrite = has("groups:write");
  const canDelete = has("groups:delete");
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setActionError(null);
    try { await fn(); } catch { setActionError("Action failed. Please try again."); }
  }

  if (loading) return <Spinner label="Loading groups…" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Groups</h1>
        {canWrite ? (
          <button type="button" onClick={() => navigate("/admin/groups/new")} className={primaryBtn}>New group</button>
        ) : null}
      </div>

      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}
      {actionError ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{actionError}</div> : null}

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Roles</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {groups.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-slate-500">No groups yet.</td></tr>
            ) : (
              groups.map((g) => (
                <tr key={g.id} className="text-slate-200">
                  <td className="px-4 py-3">{g.name}{g.isSystem ? <SystemTag /> : null}</td>
                  <td className="px-4 py-3 text-slate-400">{g.description ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {g.roleIds.length === 0 ? "—" : (
                      <div className="flex flex-wrap gap-1">
                        {g.roleIds.map((rid) => (
                          <span key={rid} className="rounded-full bg-slate-700/40 px-2 py-0.5 text-xs text-slate-300">{roleName.get(rid) ?? rid}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canWrite ? (
                        <button type="button" disabled={g.isSystem} title={g.isSystem ? "Protected system group" : undefined} onClick={() => navigate(`/admin/groups/${g.id}/edit`)} className={rowBtn}>Edit</button>
                      ) : null}
                      {canDelete ? (
                        <button type="button" disabled={g.isSystem} title={g.isSystem ? "Protected system group" : undefined}
                          onClick={() => void run(async () => {
                            if (await confirm({ title: "Delete group", message: `Delete group "${g.name}"? This cannot be undone.`, confirmLabel: "Delete" }))
                              await deleteGroup(g.id);
                          })}
                          className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40">Delete</button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
