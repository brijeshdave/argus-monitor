/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Display-devices admin: TVs/wallboards self-register and appear here pending
 * approval. Operators approve (→ one-time token), revoke, assign a wallboard
 * layout, or delete. Pending devices are highlighted at the top of the table.
 */
import { useMemo, useState } from "react";
import { type WallDeviceDTO, type WallLayoutDTO } from "@argus/shared";
import { useDevices } from "@/hooks/useDevices";
import { useAuth } from "@/auth/AuthContext";
import { useConfirm } from "@/components/ConfirmProvider";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { PromptDialog } from "@/components/PromptDialog";

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Pending devices first; then by creation time so new arrivals surface quickly. */
function orderDevices(devices: WallDeviceDTO[]): WallDeviceDTO[] {
  const rank: Record<string, number> = { pending: 0, approved: 1, revoked: 2 };
  return [...devices].sort((a, b) => {
    const r = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    if (r !== 0) return r;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function DevicesPage() {
  const { has } = useAuth();
  const confirm = useConfirm();
  const { loading, error, devices, layouts, deviceGroups, create, revoke, assignLayout, assignGroup, createGroup, updateGroup, deleteGroup, remove } = useDevices();

  const canWrite = has("devices:write");
  const canDelete = has("devices:delete");

  const [actionError, setActionError] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [creatingDevice, setCreatingDevice] = useState(false);

  const ordered = useMemo(() => orderDevices(devices), [devices]);
  const layoutName = useMemo(() => {
    const map = new Map(layouts.map((l) => [l.id, l.name]));
    return (id: string | null) => (id ? map.get(id) ?? id : "—");
  }, [layouts]);
  const groupName = useMemo(() => {
    const map = new Map(deviceGroups.map((g) => [g.id, g.name]));
    return (id: string | null) => (id ? map.get(id) ?? id : "—");
  }, [deviceGroups]);
  const groupCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of devices) if (d.groupId) m.set(d.groupId, (m.get(d.groupId) ?? 0) + 1);
    return m;
  }, [devices]);

  async function runAction(fn: () => Promise<void>) {
    setActionError(null);
    try {
      await fn();
    } catch {
      setActionError("Action failed. Please try again.");
    }
  }

  async function onAssign(device: WallDeviceDTO, layoutId: string) {
    await runAction(() => assignLayout(device.id, layoutId === "" ? null : layoutId));
  }

  if (loading) return <Spinner label="Loading devices…" />;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-slate-100">Display devices</h1>
          {canWrite ? (
            <button
              type="button"
              onClick={() => setCreatingDevice(true)}
              className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400"
            >
              Add display
            </button>
          ) : null}
        </div>
        <p className="max-w-3xl text-sm text-slate-400">
          Click <span className="text-slate-200">Add display</span> to get a 6-digit code. On the screen open
          <span className="font-mono text-sky-300"> /wall</span>, enter the code, and it pairs itself — then assign it a
          board, directly or via its group. Displays re-resolve their board on a poll, so reassigning here updates the
          screen with nothing to touch. A re-connected screen is recognised as the same device.
          <span className="block pt-1 text-xs text-slate-500">The global display session lifetime is set in <span className="text-slate-300">Settings → Displays</span>.</span>
        </p>
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

      {/* Device groups — assign one board to many displays, server-side. */}
      <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Device groups</h2>
          {canWrite ? (
            <button
              type="button"
              onClick={() => setCreatingGroup(true)}
              className="rounded-md border border-sky-600/50 px-2.5 py-1 text-xs text-sky-300 transition-colors hover:bg-sky-500/10"
            >
              New group
            </button>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          Assign a wallboard to a group and every display in it shows that board (changeable any time, no need to touch the screen). A per-device layout overrides the group.
        </p>
        {deviceGroups.length === 0 ? (
          <p className="text-sm text-slate-500">No groups yet.</p>
        ) : (
          <div className="space-y-2">
            {deviceGroups.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center gap-2">
                <input
                  defaultValue={g.name}
                  disabled={!canWrite}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== g.name) void runAction(() => updateGroup(g.id, { name: v }));
                  }}
                  className="w-44 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
                />
                <select
                  value={g.layoutId ?? ""}
                  disabled={!canWrite}
                  onChange={(e) => void runAction(() => updateGroup(g.id, { layoutId: e.target.value || null }))}
                  title="Board shown on this group's displays"
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
                >
                  <option value="">No board</option>
                  {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <span className="text-xs text-slate-500">{groupCount.get(g.id) ?? 0} device(s)</span>
                {canDelete ? (
                  <button
                    type="button"
                    onClick={() =>
                      void (async () => {
                        if (await confirm({ title: "Delete group", message: `Delete group "${g.name}"? Its devices will be ungrouped.`, confirmLabel: "Delete" }))
                          await runAction(() => deleteGroup(g.id));
                      })()
                    }
                    className="ml-auto rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Group</th>
              <th className="px-4 py-3 font-medium">Layout</th>
              <th className="px-4 py-3 font-medium">Last seen</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {ordered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-slate-500">
                  No devices have registered yet.
                </td>
              </tr>
            ) : (
              ordered.map((d) => (
                <tr
                  key={d.id}
                  className={`text-slate-200 ${d.status === "pending" ? "bg-amber-500/5" : ""}`}
                >
                  <td className="px-4 py-3 font-medium">
                    {d.name}
                    {d.pairingCode ? (
                      <div className="mt-0.5 font-mono text-xs tracking-widest text-sky-300" title="Code shown on the screen">code {d.pairingCode}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={d.status} />
                      {d.status === "approved" ? (
                        <span className={`inline-flex items-center gap-1 text-xs ${d.online ? "text-emerald-400" : "text-slate-500"}`} title={d.online ? "Wallboard open & live" : "Not displaying (page closed or offline)"}>
                          <span className={`h-2 w-2 rounded-full ${d.online ? "bg-emerald-400" : "bg-slate-600"}`} />
                          {d.online ? "live" : "offline"}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {canWrite && d.status === "approved" ? (
                      <select
                        value={d.groupId ?? ""}
                        onChange={(e) => void runAction(() => assignGroup(d.id, e.target.value || null))}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
                      >
                        <option value="">No group</option>
                        {deviceGroups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-slate-400">{groupName(d.groupId)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canWrite && d.status === "approved" ? (
                      <select
                        value={d.layoutId ?? ""}
                        onChange={(e) => void onAssign(d, e.target.value)}
                        title="Per-device board (overrides the group's board)"
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
                      >
                        <option value="">{d.groupId ? `Group board (${layoutName(d.effectiveLayoutId)})` : "No layout"}</option>
                        {layouts.map((l: WallLayoutDTO) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-slate-400">{layoutName(d.effectiveLayoutId)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{formatWhen(d.lastSeenAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canWrite && d.status !== "revoked" ? (
                        <button
                          type="button"
                          onClick={() =>
                            void (async () => {
                              if (await confirm({ title: "Revoke device", message: `Revoke device "${d.name}"? Its kiosk session will be disconnected.`, confirmLabel: "Revoke" }))
                                await runAction(() => revoke(d.id));
                            })()
                          }
                          className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 transition-colors hover:bg-rose-500/10"
                        >
                          Revoke
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() =>
                            void (async () => {
                              if (await confirm({ title: "Delete device", message: `Delete device "${d.name}"? This cannot be undone.`, confirmLabel: "Delete" }))
                                await runAction(() => remove(d.id));
                            })()
                          }
                          className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500"
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {creatingDevice ? (
        <PromptDialog
          title="Add display"
          label="Display name (e.g. NOC TV 1)"
          defaultValue=""
          confirmLabel="Create code"
          onCancel={() => setCreatingDevice(false)}
          onSubmit={async (name) => {
            if (name.trim()) await runAction(() => create(name.trim()));
            setCreatingDevice(false);
          }}
        />
      ) : null}

      {creatingGroup ? (
        <PromptDialog
          title="New device group"
          label="Group name"
          defaultValue=""
          confirmLabel="Create"
          onCancel={() => setCreatingGroup(false)}
          onSubmit={async (name) => {
            if (name.trim()) await runAction(() => createGroup(name.trim()));
            setCreatingGroup(false);
          }}
        />
      ) : null}

    </div>
  );
}
