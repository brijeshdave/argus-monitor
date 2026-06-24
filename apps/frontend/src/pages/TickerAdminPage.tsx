/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Ticker admin: a list of scrolling messages with their severity, window, audience
 * targeting and enabled state. Create/edit happen on a dedicated page
 * (/ticker/new, /ticker/:id/edit) — see TickerEditorPage.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TICKER_SPEEDS, TICKER_SPEED_MAX, TICKER_SPEED_MIN, type TickerMessageDTO } from "@argus/shared";
import { useTicker } from "@/hooks/useTicker";
import { useAuth } from "@/auth/AuthContext";
import { useConfirm } from "@/components/ConfirmProvider";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";

function formatWindow(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** "All" / "N group(s)" summary for a targeting list. */
function targetLabel(ids: string[], noun: string): string {
  return ids.length === 0 ? `All ${noun}s` : `${ids.length} ${noun} group${ids.length === 1 ? "" : "s"}`;
}

export function TickerAdminPage() {
  const { has } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { loading, error, messages, speed, remove, saveSpeed } = useTicker();
  const canWrite = has("ticker:write");
  const [actionError, setActionError] = useState<string | null>(null);
  const [speedBusy, setSpeedBusy] = useState(false);

  async function onSpeed(px: number) {
    setSpeedBusy(true);
    setActionError(null);
    try { await saveSpeed(px); } catch { setActionError("Failed to save ticker speed."); }
    finally { setSpeedBusy(false); }
  }

  async function onDelete(m: TickerMessageDTO) {
    if (await confirm({ title: "Delete ticker message", message: "Delete this ticker message? This cannot be undone.", confirmLabel: "Delete" })) {
      setActionError(null);
      try { await remove(m.id); } catch { setActionError("Failed to delete the message."); }
    }
  }

  if (loading) return <Spinner label="Loading ticker…" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-100">Ticker messages</h1>
        {canWrite ? (
          <button type="button" onClick={() => navigate("/ticker/new")} className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400">New message</button>
        ) : null}
      </div>

      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}
      {actionError ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{actionError}</div> : null}

      {/* Global scroll speed — applies to every screen + the operator bar. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <span className="text-xs uppercase tracking-wide text-slate-500">Scroll speed</span>
        <input
          type="range" min={TICKER_SPEED_MIN} max={TICKER_SPEED_MAX} step={5} value={speed}
          disabled={!canWrite || speedBusy}
          onChange={(e) => onSpeed(Number(e.target.value))}
          className="h-2 w-56 cursor-pointer accent-sky-500 disabled:opacity-50"
        />
        <span className="w-16 font-mono text-sm text-slate-300">{speed} px/s</span>
        <div className="flex gap-1.5">
          {TICKER_SPEEDS.map((s) => (
            <button key={s.label} type="button" disabled={!canWrite || speedBusy}
              onClick={() => onSpeed(s.px)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${speed === s.px ? "border-sky-500/50 bg-sky-500/15 text-sky-200" : "border-slate-700 text-slate-300 hover:border-slate-500"}`}>
              {s.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">Higher = faster. Applies to all walls + the operator bar.</span>
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Text</th>
              <th className="px-4 py-3 font-medium">Severity</th>
              <th className="px-4 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium">Enabled</th>
              <th className="px-4 py-3 font-medium">Audience</th>
              <th className="px-4 py-3 font-medium">Window</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {messages.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-slate-500">No ticker messages yet.</td></tr>
            ) : (
              messages.map((m) => (
                <tr key={m.id} className="text-slate-200">
                  <td className="px-4 py-3 max-w-md truncate">{m.text}</td>
                  <td className="px-4 py-3"><StatusBadge status={m.severity} /></td>
                  <td className="px-4 py-3 text-slate-400">{m.priority}</td>
                  <td className="px-4 py-3"><StatusBadge status={m.enabled ? "approved" : "revoked"} /></td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    <div>🖥 {targetLabel(m.deviceGroupIds ?? [], "wall")}</div>
                    <div>👤 {targetLabel(m.userGroupIds ?? [], "user")}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{formatWindow(m.startsAt)} → {formatWindow(m.endsAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canWrite ? <button type="button" onClick={() => navigate(`/ticker/${m.id}/edit`)} className="rounded-md border border-sky-600/50 px-2.5 py-1 text-xs text-sky-300 transition-colors hover:bg-sky-500/10">Edit</button> : null}
                      {canWrite ? <button type="button" onClick={() => void onDelete(m)} className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 transition-colors hover:bg-rose-500/10">Delete</button> : null}
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
