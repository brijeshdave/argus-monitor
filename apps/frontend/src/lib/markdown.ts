/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Markdown helpers for the docs system: parse simple frontmatter and render
 * Markdown to sanitised HTML. Docs are authored as .md files (see content/help and
 * content/developer); marked does the parsing and DOMPurify sanitises the output so
 * even community-contributed content can't inject script.
 */
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { DocFile } from "@argus/shared";

marked.setOptions({ gfm: true, breaks: false });

/** Render a Markdown string to sanitised HTML (safe for dangerouslySetInnerHTML). */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
}

/** Parse `--- frontmatter ---` + body into a DocFile. Missing fields get defaults. */
export function parseDocFile(id: string, raw: string): DocFile {
  let title = id;
  let order = 999;
  let faq = false;
  let body = raw;

  const fm = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
  if (fm) {
    body = fm[2] ?? raw;
    for (const line of (fm[1] ?? "").split("\n")) {
      const i = line.indexOf(":");
      if (i === -1) continue;
      const key = line.slice(0, i).trim();
      const val = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (key === "title") title = val;
      else if (key === "order") order = Number(val) || 999;
      else if (key === "faq") faq = val === "true";
    }
  }
  return { id, title, order, faq, markdown: body.trim() };
}

/** Split an FAQ body ("## Question" + answer) into Q/A pairs, plus any intro. */
export function splitFaq(markdown: string): { intro: string; items: { q: string; a: string }[] } {
  const idx = markdown.search(/^##\s+/m);
  const intro = idx === -1 ? markdown : markdown.slice(0, idx).trim();
  const rest = idx === -1 ? "" : markdown.slice(idx);
  const items = rest
    .split(/^##\s+/m)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((chunk) => {
      const nl = chunk.indexOf("\n");
      return nl === -1 ? { q: chunk.trim(), a: "" } : { q: chunk.slice(0, nl).trim(), a: chunk.slice(nl + 1).trim() };
    });
  return { intro, items };
}
