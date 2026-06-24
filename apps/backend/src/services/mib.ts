/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Focused SNMP MIB parser + OID-name store. Not a full ASN.1 compiler — it extracts
 * OID assignments (OBJECT IDENTIFIER / OBJECT-TYPE / MODULE-IDENTITY / …) and resolves
 * each to a numeric OID (seeded with the well-known SMI roots), capturing UNITS and
 * DESCRIPTION. The resolved name map is stored so the browse tool / collectors can
 * turn numeric OIDs into friendly names — the practical half of "MIB support" without
 * a heavyweight compiler. Pure parse; DB import/resolve are thin wrappers.
 */
import { eq } from "drizzle-orm";
import { mibObjects, type MasterDb } from "@argus/db";

export interface MibObject {
  oid: string;
  name: string;
  unit?: string;
  description?: string;
}

/** Well-known SMI roots so module references (enterprises, mib-2, …) resolve. */
const BASE: Record<string, number[]> = {
  iso: [1],
  org: [1, 3],
  dod: [1, 3, 6],
  internet: [1, 3, 6, 1],
  directory: [1, 3, 6, 1, 1],
  mgmt: [1, 3, 6, 1, 2],
  "mib-2": [1, 3, 6, 1, 2, 1],
  transmission: [1, 3, 6, 1, 2, 1, 10],
  experimental: [1, 3, 6, 1, 3],
  private: [1, 3, 6, 1, 4],
  enterprises: [1, 3, 6, 1, 4, 1],
  security: [1, 3, 6, 1, 5],
  snmpV2: [1, 3, 6, 1, 6],
  "snmpModules": [1, 3, 6, 1, 6, 3],
  "host": [1, 3, 6, 1, 2, 1, 25],
};

/** Strip ASN.1 comments (-- to -- or EOL) while respecting double-quoted strings. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < src.length) {
    const c = src[i]!;
    if (inStr) {
      out += c;
      if (c === '"') inStr = false;
      i += 1;
      continue;
    }
    if (c === '"') { inStr = true; out += c; i += 1; continue; }
    if (c === "-" && src[i + 1] === "-") {
      // comment to next "--" or end of line
      i += 2;
      while (i < src.length && src[i] !== "\n") {
        if (src[i] === "-" && src[i + 1] === "-") { i += 2; break; }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const ASSIGN_RE =
  /([a-zA-Z][\w-]*)\s+(?:OBJECT-TYPE|OBJECT\s+IDENTIFIER|MODULE-IDENTITY|OBJECT-IDENTITY|OBJECT-GROUP|NOTIFICATION-TYPE)\b([\s\S]*?)::=\s*\{([^}]*)\}/g;

interface Raw { name: string; tokens: string[]; unit?: string; description?: string }

/** Parse a MIB module's text into resolved OID objects (best-effort). */
export function parseMib(text: string): { objects: MibObject[]; parsed: number; resolved: number } {
  const clean = stripComments(text);
  const raws: Raw[] = [];
  for (const m of clean.matchAll(ASSIGN_RE)) {
    const name = m[1]!;
    const body = m[2] ?? "";
    const braces = (m[3] ?? "").trim();
    if (!braces) continue;
    const tokens = braces.split(/\s+/).filter(Boolean);
    const unit = /UNITS\s+"([^"]*)"/.exec(body)?.[1];
    const description = /DESCRIPTION\s+"([^"]*)"/.exec(body)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 300);
    raws.push({ name, tokens, unit, description });
  }

  const map = new Map<string, number[]>(Object.entries(BASE));
  // Iterate to a fixpoint — definitions may reference symbols declared later.
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of raws) {
      if (map.has(r.name)) continue;
      const arr = resolveTokens(r.tokens, map);
      if (arr) { map.set(r.name, arr); changed = true; }
    }
  }

  const byOid = new Map<string, MibObject>();
  let resolved = 0;
  for (const r of raws) {
    const arr = map.get(r.name);
    if (!arr) continue;
    resolved += 1;
    byOid.set(arr.join("."), { oid: arr.join("."), name: r.name, unit: r.unit, description: r.description });
  }
  return { objects: [...byOid.values()], parsed: raws.length, resolved };
}

/** Resolve an OID value's brace tokens to a numeric array, or null if unresolved. */
function resolveTokens(tokens: string[], map: Map<string, number[]>): number[] | null {
  const out: number[] = [];
  for (const tk of tokens) {
    if (/^\d+$/.test(tk)) { out.push(Number(tk)); continue; }
    const named = /^[\w-]+\((\d+)\)$/.exec(tk); // e.g. iso(1)
    if (named) { out.push(Number(named[1])); continue; }
    if (/^[a-zA-Z][\w-]*$/.test(tk)) {
      const base = map.get(tk);
      if (!base) return null; // parent symbol not known yet
      out.push(...base);
      continue;
    }
    return null; // unexpected token
  }
  return out.length ? out : null;
}

/** Parse + upsert a MIB's objects under a module name; returns counts. */
export async function importMib(db: MasterDb, mibName: string, text: string): Promise<{ imported: number; parsed: number }> {
  const { objects, parsed } = parseMib(text);
  if (objects.length === 0) return { imported: 0, parsed };
  // Replace this module's prior objects, then insert fresh.
  await db.delete(mibObjects).where(eq(mibObjects.mib, mibName));
  const now = new Date().toISOString();
  const rows = objects.map((o) => ({ oid: o.oid, name: o.name, unit: o.unit ?? null, description: o.description ?? null, mib: mibName, updatedAt: now }));
  // Upsert by oid (another module may already own it) in chunks.
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(mibObjects).values(rows.slice(i, i + 500)).onConflictDoUpdate({
      target: mibObjects.oid,
      set: { name: mibObjects.name, unit: mibObjects.unit, description: mibObjects.description, mib: mibObjects.mib },
    });
  }
  return { imported: objects.length, parsed };
}

/** List imported MIB modules with object counts. */
export async function listMibs(db: MasterDb): Promise<Array<{ mib: string; count: number }>> {
  const rows = await db.select({ mib: mibObjects.mib }).from(mibObjects);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.mib, (counts.get(r.mib) ?? 0) + 1);
  return [...counts.entries()].map(([mib, count]) => ({ mib, count })).sort((a, b) => a.mib.localeCompare(b.mib));
}

export async function deleteMib(db: MasterDb, mibName: string): Promise<void> {
  await db.delete(mibObjects).where(eq(mibObjects.mib, mibName));
}

/**
 * Resolve names for a set of exact OIDs (e.g. browse results). Matches exact OID
 * first, then the longest known prefix (table column + row index → "name #idx").
 */
export async function resolveOidNames(db: MasterDb, oids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (oids.length === 0) return out;
  // Pull all objects once (the map is small relative to a walk) for prefix matching.
  const all = await db.select({ oid: mibObjects.oid, name: mibObjects.name }).from(mibObjects);
  if (all.length === 0) return out;
  const exact = new Map(all.map((r) => [r.oid, r.name]));
  // Sort known oids by length desc for longest-prefix matching.
  const known = all.map((r) => r.oid).sort((a, b) => b.length - a.length);
  for (const oid of oids) {
    const o = oid.replace(/^\./, "");
    if (exact.has(o)) { out.set(oid, exact.get(o)!); continue; }
    const base = known.find((k) => o === k || o.startsWith(`${k}.`));
    if (!base) continue;
    const rest = o.slice(base.length).replace(/^\./, "");
    // Only name a true instance: the scalar instance ".0", or a single table-row
    // index. Deeper remainders mean we only matched an ancestor — don't mislabel.
    if (!rest || rest === "0") out.set(oid, exact.get(base)!);
    else if (/^\d+$/.test(rest)) out.set(oid, `${exact.get(base)!} #${rest}`);
  }
  return out;
}
