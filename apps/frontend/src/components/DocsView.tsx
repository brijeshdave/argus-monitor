/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Renders a DocSet (Markdown pages) as a help article: a sticky table of contents,
 * a live filter box, rendered sections, and an FAQ accordion for files flagged
 * `faq: true`. Used by both the public help centre (/docs) and the gated developer
 * docs (/developers). Markdown is rendered + sanitised in @/lib/markdown.
 */
import { useMemo, useState } from "react";
import type { DocFile, DocSet } from "@argus/shared";
import { renderMarkdown, splitFaq } from "@/lib/markdown";

/** Scoped styling for rendered Markdown (no Tailwind typography plugin needed). */
const MD_STYLE = `
.argus-md{color:#cbd5e1;font-size:0.875rem;line-height:1.65}
.argus-md h1,.argus-md h2,.argus-md h3,.argus-md h4{color:#f1f5f9;font-weight:600;line-height:1.3;margin:1.25rem 0 .5rem}
.argus-md h1{font-size:1.25rem}.argus-md h2{font-size:1.05rem}.argus-md h3{font-size:.95rem}.argus-md h4{font-size:.875rem}
.argus-md p{margin:.6rem 0}
.argus-md a{color:#7dd3fc;text-decoration:underline}
.argus-md ul,.argus-md ol{margin:.6rem 0;padding-left:1.4rem}
.argus-md ul{list-style:disc}.argus-md ol{list-style:decimal}
.argus-md li{margin:.25rem 0}
.argus-md code{background:#1e293b;color:#7dd3fc;padding:.1rem .35rem;border-radius:.25rem;font-size:.85em}
.argus-md pre{background:#020617;border:1px solid #1e293b;border-radius:.5rem;padding:.85rem;overflow-x:auto;margin:.75rem 0}
.argus-md pre code{background:none;color:#e2e8f0;padding:0;font-size:.8rem;line-height:1.55}
.argus-md blockquote{border-left:3px solid #334155;padding:.25rem .9rem;margin:.75rem 0;color:#94a3b8;background:#0f172a55;border-radius:0 .25rem .25rem 0}
.argus-md table{border-collapse:collapse;margin:.75rem 0;width:100%;font-size:.82rem}
.argus-md th,.argus-md td{border:1px solid #1e293b;padding:.4rem .6rem;text-align:left}
.argus-md th{background:#0f172a;color:#e2e8f0}
.argus-md hr{border:0;border-top:1px solid #1e293b;margin:1.25rem 0}
.argus-md img{max-width:100%;border-radius:.5rem}
`;

function Markdown({ md }: { md: string }) {
  const html = useMemo(() => renderMarkdown(md), [md]);
  return <div className="argus-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function FaqAccordion({ md }: { md: string }) {
  const { intro, items } = useMemo(() => splitFaq(md), [md]);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      {intro ? <Markdown md={intro} /> : null}
      <div className="space-y-2">
        {items.map((f, i) => (
          <div key={i} className="rounded-md border border-slate-800 bg-slate-900/40">
            <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-slate-200">
              <span>{f.q}</span>
              <span className="shrink-0 text-slate-500">{open === i ? "–" : "+"}</span>
            </button>
            {open === i ? <div className="border-t border-slate-800 px-4 py-3"><Markdown md={f.a} /></div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function matches(file: DocFile, q: string): boolean {
  return !q || (file.title + "\n" + file.markdown).toLowerCase().includes(q);
}

export function DocsView({ set }: { set: DocSet }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const files = useMemo(() => [...set.files].sort((a, b) => a.order - b.order), [set.files]);
  const visible = useMemo(() => files.filter((f) => matches(f, q)), [files, q]);

  return (
    <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <style>{MD_STYLE}</style>

      {/* Table of contents */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the docs…"
          className="mb-4 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
        <nav className="space-y-1 text-sm">
          {files.map((f) => (
            <a key={f.id} href={`#${f.id}`} className="block rounded px-2 py-1 text-slate-400 transition-colors hover:bg-slate-800/60 hover:text-slate-200">{f.title}</a>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="min-w-0 max-w-3xl space-y-10">
        {visible.length === 0 ? <p className="text-sm text-slate-500">No matches for “{query}”.</p> : null}
        {visible.map((f) => (
          <section key={f.id} id={f.id} className="scroll-mt-6 space-y-3">
            <h2 className="border-b border-slate-800 pb-2 text-lg font-semibold text-slate-100">{f.title}</h2>
            {f.faq ? <FaqAccordion md={f.markdown} /> : <Markdown md={f.markdown} />}
          </section>
        ))}
      </div>
    </div>
  );
}
