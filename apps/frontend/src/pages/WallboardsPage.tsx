/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Wallboards index: lists saved layouts with default/system tags and links to the
 * builder (/wallboards/:id) and full-screen kiosk (/wall/:id). New / Clone create
 * layouts; protected (default/system) layouts cannot be deleted.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useWallboards } from "@/hooks/useWallboards";
import { useWallEntities, type Widget } from "@/hooks/useWallEntities";
import { useAuth } from "@/auth/AuthContext";
import { Spinner } from "@/components/Spinner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PromptDialog } from "@/components/PromptDialog";
import { Modal } from "@/components/Modal";

/** Starter layouts for a new wallboard. */
const TEMPLATES = [
  { key: "blank", label: "Blank — add tiles yourself" },
  { key: "fleet", label: "Fleet — every host + its monitors, grouped" },
  { key: "status", label: "Status board — one compact tile per host" },
] as const;
type TemplateKey = (typeof TEMPLATES)[number]["key"];

type Dialog =
  | { kind: "new" }
  | { kind: "clone"; id: string; fromName: string }
  | { kind: "delete"; id: string; name: string }


function Tag({ children, tone }: { children: string; tone: "sky" | "violet" }) {
  const cls =
    tone === "sky"
      ? "bg-sky-500/15 text-sky-300 ring-sky-500/30"
      : "bg-violet-500/15 text-violet-300 ring-violet-500/30";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ${cls}`}
    >
      {children}
    </span>
  );
}


export function WallboardsPage() {
  const { has } = useAuth();
  const { loading, error, layouts, create, clone, remove, setDefault } = useWallboards();
  const { agents, defaultWidgets } = useWallEntities();

  const canWrite = has("wallboards:write");
  const canDelete = has("wallboards:delete");

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState<TemplateKey>("fleet");

  /** Build the seed layout JSON for a chosen starter template. */
  function buildTemplateLayout(kind: TemplateKey): Record<string, unknown> {
    if (kind === "fleet") return { widgets: defaultWidgets() };
    if (kind === "status") {
      const widgets: Widget[] = agents.map((a) => ({ id: `t_${a.id}`, kind: "agent", refId: a.id, size: "sm", metrics: [] }));
      return { widgets };
    }
    return { widgets: [] }; // blank
  }

  async function runAction(fn: () => Promise<void>) {
    setActionError(null);
    setBusy(true);
    try {
      await fn();
    } catch {
      setActionError("Action failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading wallboards…" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-100">Wallboards</h1>
        {canWrite ? (
          <button
            type="button"
            onClick={() => setDialog({ kind: "new" })}
            disabled={busy}
            className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-60"
          >
            New wallboard
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      ) : null}
      {actionError ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {actionError}
        </div>
      ) : null}

      {layouts.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-6 text-sm text-slate-500">
          No wallboards yet.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {layouts.map((l) => {
            const protectedLayout = l.isDefault || l.isSystem;
            return (
              <div
                key={l.id}
                className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/40 p-4"
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-100">{l.name}</h2>
                    {l.isDefault ? <Tag tone="sky">default</Tag> : null}
                    {l.isSystem ? <Tag tone="violet">system</Tag> : null}
                  </div>
                  {l.description ? (
                    <p className="text-sm text-slate-400">{l.description}</p>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    to={`/wallboards/${l.id}`}
                    className="rounded-md border border-sky-600/50 px-2.5 py-1 text-xs text-sky-300 transition-colors hover:bg-sky-500/10"
                  >
                    Builder
                  </Link>
                  <Link
                    to={`/wall/${l.id}?fullscreen=1`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500"
                  >
                    Open kiosk ↗
                  </Link>
                  {canWrite ? (
                    <Link
                      to={`/wallboards/${l.id}/display`}
                      title="Title, layout, rotation, hosts & per-host detail shown on every screen"
                      className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500"
                    >
                      Display
                    </Link>
                  ) : null}
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => setDialog({ kind: "clone", id: l.id, fromName: l.name })}
                      disabled={busy}
                      className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500 disabled:opacity-60"
                    >
                      Clone
                    </button>
                  ) : null}
                  {canWrite && !l.isDefault ? (
                    <button
                      type="button"
                      onClick={() => { setBusy(true); setActionError(null); setDefault(l.id).catch(() => setActionError("Failed to set default.")).finally(() => setBusy(false)); }}
                      disabled={busy}
                      title="Make this the board /wall opens by default"
                      className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500 disabled:opacity-60"
                    >
                      Set default
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => setDialog({ kind: "delete", id: l.id, name: l.name })}
                      disabled={busy || protectedLayout}
                      title={protectedLayout ? "Protected layout — cannot delete" : undefined}
                      className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialog?.kind === "new" ? (
        <Modal title="New wallboard" onClose={() => setDialog(null)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              void runAction(async () => {
                await create(newName.trim(), undefined, buildTemplateLayout(newTemplate));
                setNewName("");
                setNewTemplate("fleet");
                setDialog(null);
              });
            }}
          >
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Wallboard name</span>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. NOC overview"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Start from template</span>
              <select
                value={newTemplate}
                onChange={(e) => setNewTemplate(e.target.value as TemplateKey)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
              >
                {TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <span className="mt-1 block text-xs text-slate-500">Seeds the board with tiles; you can edit it afterwards.</span>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDialog(null)} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500">Cancel</button>
              <button type="submit" disabled={busy || !newName.trim()} className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60">Create</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {dialog?.kind === "clone" ? (
        <PromptDialog
          title="Clone wallboard"
          label="Name for the copy"
          defaultValue={`${dialog.fromName} copy`}
          confirmLabel="Clone"
          onCancel={() => setDialog(null)}
          onSubmit={async (name) => {
            const src = layouts.find((l) => l.id === dialog.id);
            const stored = (src?.layout as { widgets?: unknown[] } | undefined)?.widgets;
            // The default "fleet" board computes its widgets live (nothing is stored),
            // so a plain server clone would be blank — materialise the current fleet.
            if (src && (src.isDefault || !Array.isArray(stored) || stored.length === 0)) {
              await create(name, src.description, { widgets: defaultWidgets() });
            } else {
              await clone(dialog.id, name);
            }
            setDialog(null);
          }}
        />
      ) : null}

      {dialog?.kind === "delete" ? (
        <ConfirmDialog
          title="Delete wallboard"
          message={
            <>
              Delete <span className="font-medium text-slate-100">{dialog.name}</span>? This
              cannot be undone.
            </>
          }
          confirmLabel="Delete"
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            await remove(dialog.id);
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}
