/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Documentation content model. Docs are authored as **Markdown files** in the repo
 * (content/help for the public help centre, content/developer for the gated
 * developer docs) so they can be edited and reviewed via normal Git pull requests
 * by the maintainer or the community — no code changes required to add a page.
 *
 * Each Markdown file carries simple frontmatter:
 *   ---
 *   title: Installation
 *   order: 20
 *   faq: false        # optional — render "## Question" headings as an accordion
 *   ---
 * This module is just the shared shape; rendering happens in the frontend.
 */

/** One Markdown documentation page (one entry in the table of contents). */
export interface DocFile {
  id: string; // slug, derived from the filename (used as the anchor)
  title: string; // frontmatter `title`
  order: number; // frontmatter `order` (ascending; default 999)
  faq: boolean; // frontmatter `faq` — render "## …" sections as an accordion
  markdown: string; // the Markdown body (frontmatter stripped)
}

/** A complete documentation set (the help centre, or the developer docs). */
export interface DocSet {
  title: string;
  tagline?: string;
  updatedAt?: string; // ISO date the set was last revised
  files: DocFile[]; // ordered pages
}
