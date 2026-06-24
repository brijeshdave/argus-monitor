/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Users admin (list). Create/edit happen on a dedicated page (/admin/users/new,
 * /admin/users/:id/edit) and sessions on /admin/users/:id/sessions — see
 * UserEditorPage / UserSessionsPage. Access is granted ONLY via groups. Protected
 * users (isOwner || isSystem) are not editable or deletable.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUsers } from "@/hooks/useUsers";
import { useAuth } from "@/auth/AuthContext";
import { useConfirm } from "@/components/ConfirmProvider";
import { SortHeader, useSort } from "@/components/SortHeader";
import { Spinner } from "@/components/Spinner";

type UserSortKey = "username" | "displayName" | "email" | "authProvider" | "status";

const primaryBtn = "rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60";
const rowBtn = "rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40";

function SystemTag() {
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-slate-700/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300 ring-1 ring-slate-600/50">
      system
    </span>
  );
}

export function UsersPage() {
  const { has } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { loading, error, users, deleteUser, resetTwoFA } = useUsers();

  const { sorted: sortedUsers, sort } = useSort<(typeof users)[number], UserSortKey>(
    users,
    (u, key) => (key === "status" ? (u.disabled ? 1 : 0) : u[key]),
    { key: "username" },
  );

  const canRead = has("users:read");
  const canWrite = has("users:write");
  const canDelete = has("users:delete");
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setActionError(null);
    try { await fn(); } catch { setActionError("Action failed. Please try again."); }
  }

  if (loading) return <Spinner label="Loading users…" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Users</h1>
        {canWrite ? (
          <button type="button" onClick={() => navigate("/admin/users/new")} className={primaryBtn}>New user</button>
        ) : null}
      </div>

      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}
      {actionError ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{actionError}</div> : null}

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortHeader label="Username" sortKey="username" sort={sort} />
              <SortHeader label="Display name" sortKey="displayName" sort={sort} />
              <SortHeader label="Email" sortKey="email" sort={sort} />
              <SortHeader label="Provider" sortKey="authProvider" sort={sort} />
              <SortHeader label="Status" sortKey="status" sort={sort} />
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {users.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-slate-500">No users yet.</td></tr>
            ) : (
              sortedUsers.map((u) => {
                const protectedRow = u.isOwner || u.isSystem;
                return (
                  <tr key={u.id} className="text-slate-200">
                    <td className="px-4 py-3">{u.username}{protectedRow ? <SystemTag /> : null}</td>
                    <td className="px-4 py-3 text-slate-400">{u.displayName ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-400">{u.email ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-400">{u.authProvider}</td>
                    <td className="px-4 py-3">
                      {u.disabled ? (
                        <span className="inline-flex items-center rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-rose-300 ring-1 ring-rose-500/30">disabled</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-emerald-300 ring-1 ring-emerald-500/30">enabled</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {canWrite ? (
                          <>
                            <button type="button" disabled={protectedRow} title={protectedRow ? "Protected system user" : undefined} onClick={() => navigate(`/admin/users/${u.id}/edit`)} className={rowBtn}>Edit</button>
                            <button type="button" disabled={protectedRow} title={protectedRow ? "Protected system user" : "Reset two-factor authentication"}
                              onClick={() => void run(async () => {
                                if (await confirm({ title: "Reset two-factor", message: `Reset 2FA for "${u.username}"? They will need to re-enroll.`, confirmLabel: "Reset 2FA", danger: false }))
                                  await resetTwoFA(u.id);
                              })}
                              className={rowBtn}>Reset 2FA</button>
                          </>
                        ) : null}
                        {canRead ? (
                          <button type="button" onClick={() => navigate(`/admin/users/${u.id}/sessions`)} className={rowBtn}>Sessions</button>
                        ) : null}
                        {canDelete ? (
                          <button type="button" disabled={protectedRow} title={protectedRow ? "Protected system user" : undefined}
                            onClick={() => void run(async () => {
                              if (await confirm({ title: "Delete user", message: `Delete user "${u.username}"? This cannot be undone.`, confirmLabel: "Delete" }))
                                await deleteUser(u.id);
                            })}
                            className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40">Delete</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
