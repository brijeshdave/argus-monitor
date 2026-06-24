/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Loads the developer documentation from the Markdown files in ./developer/*.md and
 * returns a DocSet. Authoring is just editing those .md files (manageable via PRs).
 * The set is read once and cached. In dev the files resolve under src/; in the
 * built image the backend build copies them next to the compiled module (dist/),
 * so the same relative path works in both.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DocFile, DocSet } from "@argus/shared";

/** Parse `--- frontmatter ---` + body into a DocFile (mirrors the frontend parser). */
function parseDocFile(id: string, raw: string): DocFile {
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

let cached: DocSet | null = null;

export function loadDeveloperDocs(): DocSet {
  if (cached) return cached;
  const dir = fileURLToPath(new URL("./developer/", import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseDocFile(f.replace(/\.md$/, "").replace(/^\d+[-_]/, ""), readFileSync(`${dir}${f}`, "utf8")))
    .sort((a, b) => a.order - b.order);

  cached = {
    title: "Developer Documentation",
    tagline: "Architecture, contracts, conventions and local development.",
    updatedAt: "2026-06-24",
    files,
  };
  return cached;
}
