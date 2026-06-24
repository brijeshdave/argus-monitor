/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Public help centre (/docs). Chrome-less and unauthenticated — a brand header plus
 * the shared DocsView. Content is authored as Markdown files in src/content/help and
 * bundled at build time, so adding/editing a page is just editing a .md file (no
 * code change). See the developer docs for the editing workflow.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { DocSet } from "@argus/shared";
import { BRAND } from "@/lib/brand";
import { DocsView } from "@/components/DocsView";
import { parseDocFile } from "@/lib/markdown";

// Eagerly bundle every Markdown file in content/help as a raw string.
const HELP_FILES = import.meta.glob("../content/help/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

function buildHelpSet(): DocSet {
  const files = Object.entries(HELP_FILES)
    .map(([path, raw]) => {
      const id = path.split("/").pop()!.replace(/\.md$/, "").replace(/^\d+[-_]/, "");
      return parseDocFile(id, raw);
    })
    .sort((a, b) => a.order - b.order);
  return { title: "Help Centre", tagline: "Install, operate and configure the monitoring platform.", updatedAt: "2026-06-24", files };
}

export function DocsPage() {
  const set = useMemo(buildHelpSet, []);
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/40">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5">
          <div>
            <div className="text-lg font-semibold tracking-wide">{BRAND.name} <span className="text-slate-500">·</span> {set.title}</div>
            {set.tagline ? <div className="text-sm text-slate-400">{set.tagline}</div> : null}
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/status" className="text-slate-400 hover:text-slate-200">Status</Link>
            <Link to="/" className="rounded-md bg-sky-500 px-3 py-1.5 font-medium text-slate-950 transition-colors hover:bg-sky-400">Open app</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <DocsView set={set} />
        {set.updatedAt ? <p className="mt-12 border-t border-slate-800 pt-4 text-xs text-slate-600">Last updated {set.updatedAt}.</p> : null}
      </main>
    </div>
  );
}
