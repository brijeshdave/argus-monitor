/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Developer documentation (/developers). Gated by the `developer:read` permission:
 * the UI hides it without the permission, and the content (Markdown, authored in
 * apps/backend/src/content/developer) is fetched from a gated backend endpoint so it
 * is never shipped in the public bundle.
 */
import { useEffect, useState } from "react";
import type { DocSet } from "@argus/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/auth/AuthContext";
import { Spinner } from "@/components/Spinner";
import { DocsView } from "@/components/DocsView";

export function DevelopersPage() {
  const { has } = useAuth();
  const allowed = has("developer:read");
  const [set, setSet] = useState<DocSet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    api.get<{ set: DocSet }>("/api/developer-docs").then(
      (r) => { if (!cancelled) setSet(r.set); },
      () => { if (!cancelled) setError("Failed to load developer documentation."); },
    );
    return () => { cancelled = true; };
  }, [allowed]);

  if (!allowed) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-6 text-sm text-slate-400">
        You don't have access to the developer documentation. It requires the <span className="font-mono text-slate-300">developer:read</span> permission — ask a superadmin to add it to one of your groups' roles.
      </div>
    );
  }

  if (error) return <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>;
  if (!set) return <Spinner label="Loading developer docs…" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">{set.title}</h1>
        {set.tagline ? <p className="text-sm text-slate-400">{set.tagline}</p> : null}
      </div>
      <DocsView set={set} />
      {set.updatedAt ? <p className="mt-8 border-t border-slate-800 pt-4 text-xs text-slate-600">Last updated {set.updatedAt}.</p> : null}
    </div>
  );
}
