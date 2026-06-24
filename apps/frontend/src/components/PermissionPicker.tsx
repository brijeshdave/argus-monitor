/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Tabbed permission picker for the role editor. Permissions are grouped by their
 * resource prefix into tabs (so the previously cluttered flat checkbox list is
 * scannable), each tab showing a selected/total count, plus an overall counter
 * and per-tab / global select-all + clear. Labels come from RESOURCE_META in
 * @argus/shared so there is one source of truth for the catalogue.
 */
import { useMemo, useState } from "react";
import { RESOURCE_META } from "@argus/shared";
import type { Permission } from "@/hooks/useRoles";

/** Tab order = the RESOURCE_META declaration order; unknown resources sort last. */
const RESOURCE_ORDER = Object.keys(RESOURCE_META);

function resourceOf(key: string): string {
  return key.includes(":") ? key.slice(0, key.indexOf(":")) : "other";
}

function resourceLabel(resource: string): string {
  return (RESOURCE_META as Record<string, { label: string }>)[resource]?.label ?? resource;
}

function resourceHint(resource: string): string {
  return (RESOURCE_META as Record<string, { description: string }>)[resource]?.description ?? "";
}

/** The action part of a key ("agents:restart" → "restart") for compact labels. */
function actionOf(key: string): string {
  return key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
}

export function PermissionPicker({
  permissions,
  selected,
  onChange,
  disabled = false,
}: {
  permissions: Permission[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}) {
  // Group permissions by resource, ordered by RESOURCE_META.
  const groups = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of permissions) {
      const r = resourceOf(p.key);
      const list = map.get(r);
      if (list) list.push(p);
      else map.set(r, [p]);
    }
    return [...map.entries()].sort(([a], [b]) => {
      const ia = RESOURCE_ORDER.indexOf(a);
      const ib = RESOURCE_ORDER.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
    });
  }, [permissions]);

  const [active, setActive] = useState<string>(groups[0]?.[0] ?? "");
  const activeGroup = groups.find(([r]) => r === active) ?? groups[0];

  const countIn = (perms: Permission[]) => perms.reduce((n, p) => (selected.has(p.key) ? n + 1 : n), 0);

  function mutate(fn: (next: Set<string>) => void) {
    if (disabled) return;
    const next = new Set(selected);
    fn(next);
    onChange(next);
  }

  const toggle = (key: string) => mutate((s) => (s.has(key) ? s.delete(key) : s.add(key)));
  const setGroup = (perms: Permission[], on: boolean) =>
    mutate((s) => perms.forEach((p) => (on ? s.add(p.key) : s.delete(p.key))));
  const setAll = (on: boolean) => mutate((s) => permissions.forEach((p) => (on ? s.add(p.key) : s.delete(p.key))));

  if (permissions.length === 0) return <p className="text-sm text-slate-500">No permissions available.</p>;

  return (
    <div className="rounded-md border border-slate-800 bg-slate-950">
      {/* Header: overall counter + global select-all / clear. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <span className="text-xs text-slate-400">
          <span className="font-semibold text-slate-200">{selected.size}</span> / {permissions.length} permissions selected
        </span>
        <div className="flex gap-2">
          <button type="button" disabled={disabled} onClick={() => setAll(true)} className="rounded-md border border-slate-700 px-2 py-0.5 text-xs text-slate-300 transition-colors hover:border-slate-500 disabled:opacity-40">Select all</button>
          <button type="button" disabled={disabled} onClick={() => setAll(false)} className="rounded-md border border-slate-700 px-2 py-0.5 text-xs text-slate-300 transition-colors hover:border-slate-500 disabled:opacity-40">Clear all</button>
        </div>
      </div>

      {/* Tabs — one per resource, each with a selected/total badge. */}
      <div className="flex flex-wrap gap-1 border-b border-slate-800 p-2">
        {groups.map(([resource, perms]) => {
          const n = countIn(perms);
          const on = resource === activeGroup?.[0];
          return (
            <button
              key={resource}
              type="button"
              onClick={() => setActive(resource)}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${on ? "border-sky-500/50 bg-sky-500/15 text-sky-200" : "border-slate-700 text-slate-300 hover:border-slate-500"}`}
            >
              {resourceLabel(resource)}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${n > 0 ? "bg-sky-500/25 text-sky-100" : "bg-slate-700/60 text-slate-400"}`}>
                {n}/{perms.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active tab body. */}
      {activeGroup ? (
        <div className="p-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <p className="text-xs text-slate-500">{resourceHint(activeGroup[0])}</p>
            <div className="flex shrink-0 gap-2">
              <button type="button" disabled={disabled} onClick={() => setGroup(activeGroup[1], true)} className="text-xs text-sky-400 hover:text-sky-300 disabled:opacity-40">All</button>
              <span className="text-slate-700">·</span>
              <button type="button" disabled={disabled} onClick={() => setGroup(activeGroup[1], false)} className="text-xs text-slate-400 hover:text-slate-300 disabled:opacity-40">None</button>
            </div>
          </div>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {activeGroup[1].map((p) => (
              <label key={p.id} className={`flex items-start gap-2.5 rounded px-2 py-1.5 text-sm text-slate-200 ${disabled ? "opacity-60" : "cursor-pointer hover:bg-slate-800/60"}`}>
                <input type="checkbox" disabled={disabled} checked={selected.has(p.key)} onChange={() => toggle(p.key)} className="mt-0.5 h-4 w-4 accent-sky-500" />
                <span>
                  <span className="font-medium capitalize text-slate-100">{actionOf(p.key)}</span>
                  <span className="ml-2 font-mono text-[11px] text-slate-500">{p.key}</span>
                  {p.description ? <span className="block text-xs text-slate-500">{p.description}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
