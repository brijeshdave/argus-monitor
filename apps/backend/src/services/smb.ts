/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Server-side NAS/SMB storage probe — lets a storage monitor run from the Argus host
 * (no agent) and attach to an agentless device. Uses the Samba `smbclient` CLI.
 *
 * Capacity is read instantly from the share's `ls` ("blocks of size/available").
 * Folder sizes are built with a BOUNDED, breadth-first walk using the fast
 * NON-recursive `ls` per directory (each is ~sub-second), rolling child sizes up
 * into parents. We deliberately do NOT use `recurse ON; ls *` or `du`: on large
 * shares those must enumerate every file and take minutes per top-level folder
 * (measured 90 s+ on a real image NAS). The walk is capped by a call budget + a wall
 * deadline + a depth limit, so a probe always returns quickly; on a huge tree the
 * folder sizes are a best-effort sample (flagged `partial`) rather than a hang.
 *
 * SECURITY: host/share/folder are strictly validated (no quotes/semicolons) before
 * they enter the smbclient command, and the password is passed via the PASSWD env
 * var (never in argv / process list).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FolderNode, StorageSample } from "@argus/shared";

const execFileAsync = promisify(execFile);

const HOST_RE = /^[a-zA-Z0-9.\-]{1,253}$/;
const SHARE_RE = /^[A-Za-z0-9 ._$\-]{1,80}$/;
const SUB_RE = /^[A-Za-z0-9 ._\-/\\]{0,255}$/; // no quotes/semicolons → no smbclient injection
const MAX_FOLDERS = 3000; // cap emitted tree nodes
const MAX_LS_CALLS = 6000; // per probe — bounds work on a huge tree
const WALK_BUDGET_MS = 180_000; // wall-clock budget for the folder walk (cached → runs on the monitor's period)
const MAX_SUBDIRS_PER_DIR = 4000; // don't fan out without limit

export interface SmbWatch { sub: string; depth: number }
/** Live scan progress, reported as the walk proceeds. */
export interface ScanProgress { folders: number; files: number; bytes: number; current: string }
/** Cooperative control for a long walk: cancel aborts; pause() resolves when resumed. */
export interface ScanControl {
  isCancelled?: () => boolean;
  /** Resolves immediately unless paused, in which case it waits until resumed. */
  waitIfPaused?: () => Promise<void>;
  onProgress?: (p: ScanProgress) => void;
}

export interface SmbProbeOptions { folders?: boolean; watch?: SmbWatch[]; control?: ScanControl }

/** Thrown to unwind the walk when a scan is cancelled. */
export class ScanCancelled extends Error { constructor() { super("scan cancelled"); } }

/** Parse a UNC path (\\host\share[\sub...]) → host, share, and any base subpath. */
export function parseUnc(path: string): { host: string; share: string; base: string } | null {
  const m = /^\\\\+([^\\/]+)[\\/]+([^\\/]+)(?:[\\/]+(.*))?$/.exec(path.trim());
  if (!m) return null;
  return { host: m[1]!, share: m[2]!, base: (m[3] ?? "").replace(/\//g, "\\") };
}

/** "." / "" / "/" / "\" all mean "the share root". Otherwise normalise separators. */
function normSub(sub: string): string {
  const s = sub.trim().replace(/\//g, "\\").replace(/^\\+|\\+$/g, "");
  return s === "." ? "" : s;
}

async function smbclient(host: string, share: string, user: string, pass: string, command: string, timeoutMs = 20_000): Promise<string> {
  const args = ["//" + host + "/" + share, "-m", "SMB3", "-t", "15", "-c", command];
  const env = { ...process.env } as Record<string, string>;
  if (user) {
    args.splice(1, 0, "-U", user);
    env.PASSWD = pass || "";
  } else {
    args.splice(1, 0, "-N");
  }
  const { stdout } = await execFileAsync("smbclient", args, { env, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

const CAP_RE = /(\d+)\s+blocks of size\s+(\d+)\.\s+(\d+)\s+blocks available/;
const ENTRY_RE = /^\s+(.+?)\s+([DAHNRSET]+)\s+(\d+)\s+(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/;

interface DirListing { dirs: string[]; fileBytes: number; fileCount: number }

/** Parse a NON-recursive `ls` of one directory into its immediate dirs + file stats. */
/** NAS/OS system or hidden folders to exclude from folder stats (QNAP @Recycle /
 *  @Recently-Snapshot / .@__thumb / .streams, Windows recycle/SVI, …). */
function isSystemFolder(name: string): boolean {
  if (!name) return false;
  if (name[0] === "@" || name[0] === ".") return true;
  return ["#recycle", "$RECYCLE.BIN", "System Volume Information", "lost+found"].includes(name);
}

function parseDir(out: string): DirListing {
  const dirs: string[] = [];
  let fileBytes = 0;
  let fileCount = 0;
  for (const line of out.split("\n")) {
    const e = ENTRY_RE.exec(line);
    if (!e) continue;
    const name = e[1]!.trim();
    if (name === "." || name === "..") continue;
    if (e[2]!.includes("D")) { if (!isSystemFolder(name)) dirs.push(name); } // skip @Recycle/.streams/…
    else { fileBytes += Number(e[3]); fileCount += 1; }
  }
  return { dirs, fileBytes, fileCount };
}

interface Node { rel: string; bytes: number; files: number; subdirs: number; depth: number }

/**
 * Bounded breadth-first walk of a root folder. Returns per-directory rolled-up size
 * + file count (rolled up across whatever was visited within budget) and whether the
 * walk was truncated.
 */
async function walkRoot(
  run: (cmd: string) => Promise<string>,
  root: string,
  maxDepth: number,
  budget: { calls: number; deadline: number },
  control: ScanControl | undefined,
  totals: { folders: number; files: number; bytes: number },
): Promise<{ nodes: Node[]; partial: boolean }> {
  const nodes = new Map<string, Node>();
  const node = (rel: string, depth: number): Node => {
    let n = nodes.get(rel);
    if (!n) { n = { rel, bytes: 0, files: 0, subdirs: 0, depth }; nodes.set(rel, n); }
    return n;
  };
  const full = (rel: string) => (root ? (rel ? `${root}\\${rel}` : root) : rel);
  let partial = false;
  const queue: Array<{ rel: string; depth: number }> = [{ rel: "", depth: 0 }];

  while (queue.length) {
    if (budget.calls <= 0 || Date.now() > budget.deadline) { partial = true; break; }
    if (control?.isCancelled?.()) throw new ScanCancelled();
    if (control?.waitIfPaused) await control.waitIfPaused();
    const { rel, depth } = queue.shift()!;
    const f = full(rel);
    if (!SUB_RE.test(f)) continue;
    budget.calls -= 1;
    let listing: DirListing;
    try {
      listing = parseDir(await run(`${f ? `cd "${f}"; ` : ""}ls`));
    } catch { partial = true; continue; }
    totals.folders += 1;
    totals.files += listing.fileCount;
    totals.bytes += listing.fileBytes;
    control?.onProgress?.({ folders: totals.folders, files: totals.files, bytes: totals.bytes, current: full(rel) || "/" });
    // Credit this directory's immediate files + subfolders to it and every ancestor
    // (rolled-up recursive size / file count / subfolder count).
    let p: string | null = rel;
    while (p !== null) {
      const n = node(p, p === "" ? 0 : p.split("\\").length);
      n.bytes += listing.fileBytes;
      n.files += listing.fileCount;
      n.subdirs += listing.dirs.length;
      if (p === "") break;
      const i = p.lastIndexOf("\\");
      p = i < 0 ? "" : p.slice(0, i);
    }
    if (depth < maxDepth) {
      for (const d of listing.dirs.slice(0, MAX_SUBDIRS_PER_DIR)) {
        node(rel ? `${rel}\\${d}` : d, depth + 1); // ensure it appears even if not visited
        queue.push({ rel: rel ? `${rel}\\${d}` : d, depth: depth + 1 });
      }
      if (listing.dirs.length > MAX_SUBDIRS_PER_DIR) partial = true;
    }
  }
  return { nodes: [...nodes.values()], partial };
}

/**
 * Probe a share from the host: reachability + capacity, plus a bounded depth-limited
 * folder tree (rolled-up size + file count) for each watched folder, and — when
 * `folders` is set — the share's top-level folders.
 */
export async function smbProbe(path: string, user: string, pass: string, opts: SmbProbeOptions): Promise<StorageSample> {
  const unc = parseUnc(path);
  if (!unc || !HOST_RE.test(unc.host) || !SHARE_RE.test(unc.share)) {
    return { reachable: false, error: "invalid \\\\host\\share path" };
  }
  const { host, share, base } = unc;
  const run = (cmd: string, to?: number) => smbclient(host, share, user, pass, cmd, to);

  let capOut: string;
  try {
    capOut = await run("ls", 25_000);
  } catch (err) {
    const msg = (err as { stderr?: string }).stderr?.split("\n").find((l) => l.trim()) ?? (err as Error).message;
    return { reachable: false, error: (msg || "smb error").slice(0, 200) };
  }

  const sample: StorageSample = { reachable: true };
  const cap = CAP_RE.exec(capOut);
  if (cap) {
    const total = Number(cap[1]) * Number(cap[2]);
    const free = Number(cap[3]) * Number(cap[2]);
    const used = Math.max(0, total - free);
    sample.totalBytes = total;
    sample.freeBytes = free;
    sample.usedBytes = used;
    sample.usedPct = total > 0 ? (used / total) * 100 : null;
  }

  const roots: Array<{ sub: string; depth: number; label: string }> = [];
  for (const w of opts.watch ?? []) {
    const sub = normSub(w.sub);
    const full = base ? (sub ? `${base}\\${sub}` : base) : sub;
    if (!SUB_RE.test(full)) continue;
    // "." / "" (sub === "") → whole share: no wrapper node (label ""), like top-folder mode.
    roots.push({ sub: full, depth: Math.max(1, Math.min(6, w.depth || 1)), label: sub });
  }
  if (opts.folders && roots.length === 0) roots.push({ sub: base, depth: 1, label: "" });

  const budget = { calls: MAX_LS_CALLS, deadline: Date.now() + WALK_BUDGET_MS };
  const totals = { folders: 0, files: 0, bytes: 0 };
  const folders: FolderNode[] = [];
  let partial = false;
  for (const r of roots) {
    if (!SUB_RE.test(r.sub)) continue;
    const { nodes, partial: p } = await walkRoot(run, r.sub, r.depth, budget, opts.control, totals);
    partial = partial || p;
    for (const n of nodes) {
      // Watched folder: include the folder itself (d=0) + subdirs ≤ depth.
      // Top-folder mode (label ""): only the share's subdirs (d≥1).
      if (r.label === "" ? n.depth < 1 : false) continue;
      const relSlash = n.rel.replace(/\\/g, "/");
      const name = r.label === "" ? relSlash : (n.rel === "" ? r.label : `${r.label}/${relSlash}`);
      folders.push({ name, sizeBytes: n.bytes, fileCount: n.files, folderCount: n.subdirs });
    }
  }
  if (folders.length) {
    folders.sort((a, b) => a.name.localeCompare(b.name)); // path order → coherent tree
    sample.folders = folders.slice(0, MAX_FOLDERS);
  }
  if (partial) sample.error = "folder tree truncated — very large share; lower the depth or it will fill in over successive scans";
  return sample;
}
