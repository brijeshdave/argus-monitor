/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Dedicated page listing a user's active sessions (replaces the modal). Operators
 * with users:write can terminate individual sessions or all of them.
 */
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useUsers } from "@/hooks/useUsers";
import { useUserSessions } from "@/hooks/useUserSessions";
import { useAuth } from "@/auth/AuthContext";
import { Spinner } from "@/components/Spinner";

const btnGhost = "rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500";
const rowBtn = "rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40";

/** Best-effort browser + OS from a user-agent string (no library). */
function prettifyUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  return `${browser} on ${os}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function UserSessionsPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { has } = useAuth();
  const canWrite = has("users:write");
  const { users } = useUsers();
  const user = useMemo(() => users.find((u) => u.id === id), [users, id]);
  const { loading, error, sessions, terminate, terminateAll } = useUserSessions(id);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Sessions{user ? ` — ${user.username}` : ""}</h1>
        <button type="button" onClick={() => navigate("/admin/users")} className={btnGhost}>← Back to users</button>
      </div>

      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}

      {loading ? (
        <Spinner label="Loading sessions…" />
      ) : sessions.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-6 text-sm text-slate-500">No active sessions.</p>
      ) : (
        <>
          <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Device</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="px-4 py-3 font-medium">Last used</th>
                  {canWrite ? <th className="px-4 py-3 font-medium text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {sessions.map((s) => (
                  <tr key={s.id} className="text-slate-200">
                    <td className="px-4 py-3">{prettifyUserAgent(s.userAgent)}</td>
                    <td className="px-4 py-3 text-slate-400">{s.ip ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-400">{fmtTime(s.lastUsedAt)}</td>
                    {canWrite ? (
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <button type="button" disabled={busy} onClick={() => void run(() => terminate(s.id))} className={rowBtn}>Terminate</button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {canWrite ? (
            <div className="flex justify-end">
              <button type="button" disabled={busy} onClick={() => void run(terminateAll)} className="rounded-md border border-rose-600/50 px-3 py-2 text-sm text-rose-300 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40">Terminate all</button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
