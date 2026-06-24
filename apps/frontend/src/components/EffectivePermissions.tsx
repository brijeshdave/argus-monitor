/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Read-only summary of the permissions a user effectively has — the union of every
 * permission carried by the roles of their groups (users → groups → roles →
 * permissions). Grouped by resource with a per-resource count so reviewers can see
 * at a glance what access a group selection actually grants.
 */
import { useMemo } from "react";
import { RESOURCE_META } from "@argus/shared";

const RESOURCE_ORDER = Object.keys(RESOURCE_META);

function resourceOf(key: string): string {
  return key.includes(":") ? key.slice(0, key.indexOf(":")) : "other";
}
function resourceLabel(resource: string): string {
  return (RESOURCE_META as Record<string, { label: string }>)[resource]?.label ?? resource;
}
function actionOf(key: string): string {
  return key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
}

export function EffectivePermissions({ keys, isOwner = false }: { keys: string[]; isOwner?: boolean }) {
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const k of [...new Set(keys)]) {
      const r = resourceOf(k);
      const list = map.get(r);
      if (list) list.push(k);
      else map.set(r, [k]);
    }
    return [...map.entries()].sort(([a], [b]) => {
      const ia = RESOURCE_ORDER.indexOf(a);
      const ib = RESOURCE_ORDER.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
    });
  }, [keys]);

  if (isOwner) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
        Protected owner — has <span className="font-semibold">all permissions</span>, regardless of groups.
      </div>
    );
  }

  if (groups.length === 0) {
    return <p className="rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-500">No permissions — this user has no access until added to a group with roles.</p>;
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-800 bg-slate-950 p-3">
      <p className="text-xs text-slate-400"><span className="font-semibold text-slate-200">{new Set(keys).size}</span> effective permissions across {groups.length} resource{groups.length === 1 ? "" : "s"}.</p>
      {groups.map(([resource, perms]) => (
        <div key={resource}>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{resourceLabel(resource)} <span className="text-slate-600">({perms.length})</span></div>
          <div className="flex flex-wrap gap-1.5">
            {perms.sort().map((k) => (
              <span key={k} className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs capitalize text-sky-200" title={k}>{actionOf(k)}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
