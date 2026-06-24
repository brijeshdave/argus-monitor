/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Agent build service: cross-compiles the Go agent on demand and serves the
 * resulting artifacts for download. Each build lives in its own folder keyed by
 * version + platform — DATA_DIR/agent-builds/<version>/<os>-<arch>/argus-monitor[.exe]
 * — so the filename is constant ("argus-monitor") and versions/platforms are
 * differentiated by path. The download history is the set of these folders.
 *
 * SECURITY-SENSITIVE — this spawns a compiler:
 *   - OS/arch are validated against fixed allowlists before they reach the child
 *     process env (the ONLY operator-influenced values), via execFile (never a shell);
 *   - the version segment is sanitised and every served path is confined to BUILD_DIR.
 */
import { promises as fs, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Directory where built agent artifacts live (under DATA_DIR; created on build). */
export const BUILD_DIR = resolve(`${process.env.DATA_DIR ?? "./data"}/agent-builds`);

/** The Go module directory (relative to cwd, or overridden via env). */
export const AGENT_SRC = process.env.AGENT_SRC_DIR ?? "agent";

/** Single source of truth for the agent's semantic version (agent/VERSION). Bump it
 *  when the agent changes; every platform build for a release carries this value. */
export const AGENT_VERSION = (() => {
  try {
    return readFileSync(`${AGENT_SRC}/VERSION`, "utf8").trim() || "1.0.0";
  } catch {
    return "1.0.0";
  }
})();

/**
 * Compare two dotted versions numerically (e.g. "2.10.0" > "2.9.1"). Non-numeric
 * suffixes are ignored. Returns -1 / 0 / 1 (a<b / a==b / a>b).
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(/[.\-+]/).map((p) => Number.parseInt(p, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The ONLY OS/arch values ever passed to the compiler env / accepted on download. */
export const ALLOWED_OS = ["windows", "linux", "darwin"] as const;
export const ALLOWED_ARCH = ["amd64", "arm64"] as const;

export type AgentOS = (typeof ALLOWED_OS)[number];
export type AgentArch = (typeof ALLOWED_ARCH)[number];

/** The ldflags package path for the agent's baked build-time variable. */
const COLLECT_PKG = "github.com/brijeshdave/argus-monitor/agent/internal/collect";

/** One built artifact (a version+platform folder holding argus-monitor[.exe]). */
export interface BuildMeta {
  version: string;
  os: string;
  arch: string;
  size: number;
  builtAt: string;
  /** For os="nas": the image archive format ("qnap" | "docker"). */
  format?: string;
}

/** True when a Go toolchain is callable on this host. */
export async function goAvailable(): Promise<boolean> {
  try {
    await execFileAsync("go", ["version"]);
    return true;
  } catch {
    return false;
  }
}

/** Constant binary name (Windows carries .exe); identical across all versions. */
function binaryName(os: AgentOS): string {
  return `argus-monitor${os === "windows" ? ".exe" : ""}`;
}

/** A filesystem-safe version segment (rejects path separators / traversal). */
function safeVersion(version: string): string {
  const v = version.trim().replace(/[^A-Za-z0-9.+_-]/g, "_");
  if (!v || v === "." || v === "..") throw new Error("invalid version");
  return v;
}

/** Absolute folder for a build, confined to BUILD_DIR (throws on escape). */
function buildDir(version: string, os: AgentOS, arch: AgentArch): string {
  const dir = resolve(BUILD_DIR, safeVersion(version), `${os}-${arch}`);
  if (dir !== resolve(dir) || !dir.startsWith(BUILD_DIR + sep)) throw new Error("path traversal rejected");
  return dir;
}

function assertTarget(os: string, arch: string): asserts os is AgentOS {
  if (!(ALLOWED_OS as readonly string[]).includes(os)) throw new Error(`invalid GOOS: ${os}`);
  if (!(ALLOWED_ARCH as readonly string[]).includes(arch)) throw new Error(`invalid GOARCH: ${arch}`);
}

/**
 * Cross-compile the agent for one target into its version+platform folder. Builds
 * fully offline (vendored deps + the image's own Go) since the backend container
 * can't reach the module proxy. Returns the artifact metadata.
 */
export async function buildAgent(os: string, arch: string, version: string): Promise<BuildMeta> {
  assertTarget(os, arch);
  const goos = os as AgentOS;
  const goarch = arch as AgentArch;

  const dir = buildDir(version, goos, goarch);
  await fs.mkdir(dir, { recursive: true });
  const outPath = join(dir, binaryName(goos));
  const builtAt = new Date().toISOString();

  try {
    await execFileAsync(
      "go",
      [
        "build",
        "-trimpath",
        "-ldflags",
        // Stamp version + build time (space-separated -X directives; values have no spaces).
        `-s -w -X main.Version=${version} -X ${COLLECT_PKG}.BuildTime=${builtAt}`,
        "-o",
        outPath,
        "./cmd/agent",
      ],
      {
        cwd: AGENT_SRC,
        env: {
          ...process.env,
          GOOS: goos,
          GOARCH: goarch,
          CGO_ENABLED: "0",
          // Fully offline: vendored deps + the image's own Go (no downloads).
          GOFLAGS: "-mod=vendor",
          GOTOOLCHAIN: "local",
        },
        timeout: 180_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    const firstLine = stderr.split("\n").find((l) => l.trim().length > 0)?.trim()
      ?? (err instanceof Error ? err.message : "unknown error");
    throw new Error(`agent build failed: ${firstLine}`);
  }

  const stat = await fs.stat(outPath);
  return { version: safeVersion(version), os: goos, arch: goarch, size: stat.size, builtAt: stat.mtime.toISOString() };
}

/** List every built artifact (newest first) by walking the version/platform tree. */
export async function listBuilds(): Promise<BuildMeta[]> {
  let versions: string[];
  try {
    versions = await fs.readdir(BUILD_DIR);
  } catch {
    return []; // directory not created yet → no builds
  }
  const metas: BuildMeta[] = [];
  for (const version of versions) {
    let targets: string[];
    try {
      targets = await fs.readdir(join(BUILD_DIR, version));
    } catch {
      continue; // not a directory (e.g. a stray file)
    }
    for (const target of targets) {
      const [os, arch] = target.split("-");
      if (!os || !arch) continue;
      // NAS/container image folders ("nas-<arch>") hold one image archive per format.
      if (os === "nas" && (ALLOWED_ARCH as readonly string[]).includes(arch)) {
        let files: string[] = [];
        try {
          files = await fs.readdir(join(BUILD_DIR, version, target));
        } catch {
          /* none */
        }
        for (const file of files) {
          const format = nasFormatFromFile(file);
          if (!format) continue;
          try {
            const stat = await fs.stat(join(BUILD_DIR, version, target, file));
            if (stat.isFile()) metas.push({ version, os: "nas", arch, format, size: stat.size, builtAt: stat.mtime.toISOString() });
          } catch {
            /* skip */
          }
        }
        continue;
      }
      if (!(ALLOWED_OS as readonly string[]).includes(os) || !(ALLOWED_ARCH as readonly string[]).includes(arch)) continue;
      try {
        const stat = await fs.stat(join(BUILD_DIR, version, target, binaryName(os as AgentOS)));
        if (stat.isFile()) metas.push({ version, os, arch, size: stat.size, builtAt: stat.mtime.toISOString() });
      } catch {
        // no binary in this folder → skip
      }
    }
  }
  return metas.sort((a, b) => b.builtAt.localeCompare(a.builtAt));
}

/** Read one specific build's bytes (version+platform), confined to BUILD_DIR. */
export async function readBuildFile(version: string, os: string, arch: string): Promise<{ buf: Buffer; filename: string }> {
  assertTarget(os, arch);
  const goos = os as AgentOS;
  const path = join(buildDir(version, goos, arch as AgentArch), binaryName(goos));
  return { buf: await fs.readFile(path), filename: binaryName(goos) };
}

// ---------------------------------------------------------------------------
// NAS / Container image — a daemon-free archive that reproduces EXACTLY what
// `docker save` emits on a modern (containerd) Docker: blobs/sha256/<digest>
// (gzipped layer + config + a Docker schema-2 manifest) + index.json +
// manifest.json + oci-layout, tarred with explicit names (no "./" prefix).
// This is the layout QNAP Container Station (incl. QuTS hero) accepts on Import,
// and `docker load` reads it too. Tagged argus-agent:latest.
// ---------------------------------------------------------------------------

const sha256Hex = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

/** CA bundle locations to embed so the agent can do HTTPS from a scratch rootfs. */
const CA_CANDIDATES = ["/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt"];

/** Absolute folder for a NAS image build, confined to BUILD_DIR. */
function nasImageDir(version: string, arch: AgentArch): string {
  const dir = resolve(BUILD_DIR, safeVersion(version), `nas-${arch}`);
  if (dir !== resolve(dir) || !dir.startsWith(BUILD_DIR + sep)) throw new Error("path traversal rejected");
  return dir;
}

/** NAS image archive formats. "qnap" = uncompressed OCI (Container Station / QuTS
 *  hero); "docker" = gzipped Docker schema-2 (generic `docker load`). */
export const NAS_FORMATS = ["qnap", "docker"] as const;
export type NasFormat = (typeof NAS_FORMATS)[number];

/** Download filename for a built NAS image archive, per format + arch. */
const nasImageFile = (format: NasFormat, arch: AgentArch) =>
  `argus-agent-${format}-latest${arch === "amd64" ? "" : `-${arch}`}.tar`;

/** Recover the format encoded in a NAS image filename. */
function nasFormatFromFile(name: string): NasFormat | null {
  for (const f of NAS_FORMATS) if (name.startsWith(`argus-agent-${f}-latest`)) return f;
  return null;
}

/**
 * Build the agent's NAS/container image as a daemon-free image archive. Reproduces
 * the layout a real `docker save` / QNAP Container Station export emits: blobs/sha256
 * (layer + config + image manifest) + index.json + manifest.json (with LayerSources)
 * + repositories + oci-layout, tarred with explicit names (no "./" prefix). Two formats:
 *  - "qnap":   UNCOMPRESSED OCI layers (application/vnd.oci.image.layer.v1.tar) — what
 *              QNAP QuTS hero / Container Station Import accepts (matches its own export).
 *  - "docker": gzipped Docker schema-2 layers — standard `docker load`.
 * Rootfs is a scratch image: the static binary + CA certs (tzdata is embedded). Persisted
 * under the version folder; returns path + meta.
 */
export async function buildNasImage(arch: string, version: string, format: NasFormat = "qnap"): Promise<{ path: string; filename: string; size: number }> {
  assertTarget("linux", arch);
  const goarch = arch as AgentArch;
  const ver = safeVersion(version);

  const binPath = join(buildDir(version, "linux", goarch), binaryName("linux"));
  try {
    await fs.access(binPath);
  } catch {
    await buildAgent("linux", goarch, version);
  }

  const outDir = nasImageDir(version, goarch);
  await fs.mkdir(outDir, { recursive: true });
  const outPath = join(outDir, nasImageFile(format, goarch));

  const stage = await fs.mkdtemp(join(BUILD_DIR, "nas-img-"));
  try {
    // rootfs: the binary + CA certs + spool dir.
    const root = join(stage, "rootfs");
    await fs.mkdir(join(root, "usr/local/bin"), { recursive: true });
    await fs.mkdir(join(root, "var/lib/argus"), { recursive: true });
    await fs.copyFile(binPath, join(root, "usr/local/bin/argus-agent"));
    await fs.chmod(join(root, "usr/local/bin/argus-agent"), 0o755);
    for (const ca of CA_CANDIDATES) {
      try {
        await fs.mkdir(join(root, "etc/ssl/certs"), { recursive: true });
        await fs.copyFile(ca, join(root, "etc/ssl/certs/ca-certificates.crt"));
        break;
      } catch {
        /* try next candidate */
      }
    }

    // layer tar (uncompressed) → diff_id (sha256 of the uncompressed layer).
    const tmpLayer = join(stage, "layer.tar");
    await execFileAsync("tar", ["--numeric-owner", "--owner=0", "--group=0", "-C", root, "-cf", tmpLayer, "."]);
    const layerBytes = await fs.readFile(tmpLayer);
    const diffId = sha256Hex(layerBytes);
    const now = new Date().toISOString();

    // image config (diff_ids are always over the UNCOMPRESSED layer).
    const config = {
      architecture: goarch,
      os: "linux",
      created: now,
      config: {
        Env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "ARGUS_SPOOL_DIR=/var/lib/argus"],
        Entrypoint: ["argus-agent", "run"],
        WorkingDir: "/",
      },
      rootfs: { type: "layers", diff_ids: [`sha256:${diffId}`] },
      history: [{ created: now, created_by: `argus-agent ${ver}` }],
    };
    const configBuf = Buffer.from(JSON.stringify(config));
    const configDigest = sha256Hex(configBuf);

    // format-specific layer blob + media types.
    const qnap = format === "qnap";
    const layerBlob = qnap ? layerBytes : gzipSync(layerBytes, { level: 9 });
    const layerBlobDigest = qnap ? diffId : sha256Hex(layerBlob);
    const layerMedia = qnap ? "application/vnd.oci.image.layer.v1.tar" : "application/vnd.docker.image.rootfs.diff.tar.gzip";
    const manifestMedia = qnap ? "application/vnd.oci.image.manifest.v1+json" : "application/vnd.docker.distribution.manifest.v2+json";
    const configMedia = qnap ? "application/vnd.oci.image.config.v1+json" : "application/vnd.docker.container.image.v1+json";

    const imgManifest = {
      schemaVersion: 2,
      mediaType: manifestMedia,
      config: { mediaType: configMedia, digest: `sha256:${configDigest}`, size: configBuf.length },
      layers: [{ mediaType: layerMedia, digest: `sha256:${layerBlobDigest}`, size: layerBlob.length }],
    };
    const manifestBuf = Buffer.from(JSON.stringify(imgManifest));
    const manifestDigest = sha256Hex(manifestBuf);

    // docker-save layout: blobs/sha256 + index.json + manifest.json + repositories + oci-layout.
    const pack = join(stage, "pack");
    const blobs = join(pack, "blobs", "sha256");
    await fs.mkdir(blobs, { recursive: true });
    await fs.writeFile(join(blobs, layerBlobDigest), layerBlob);
    await fs.writeFile(join(blobs, configDigest), configBuf);
    await fs.writeFile(join(blobs, manifestDigest), manifestBuf);

    const index = {
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: [
        {
          mediaType: manifestMedia,
          digest: `sha256:${manifestDigest}`,
          size: manifestBuf.length,
          annotations: { "io.containerd.image.name": "docker.io/library/argus-agent:latest", "org.opencontainers.image.ref.name": "latest" },
        },
      ],
    };
    await fs.writeFile(join(pack, "index.json"), JSON.stringify(index), "utf8");
    await fs.writeFile(
      join(pack, "manifest.json"),
      JSON.stringify([
        {
          Config: `blobs/sha256/${configDigest}`,
          RepoTags: [`argus-agent:${ver}`, "argus-agent:latest"],
          Layers: [`blobs/sha256/${layerBlobDigest}`],
          LayerSources: { [`sha256:${layerBlobDigest}`]: { mediaType: layerMedia, size: layerBlob.length, digest: `sha256:${layerBlobDigest}` } },
        },
      ]),
      "utf8",
    );
    await fs.writeFile(join(pack, "repositories"), JSON.stringify({ "argus-agent": { latest: layerBlobDigest } }), "utf8");
    await fs.writeFile(join(pack, "oci-layout"), JSON.stringify({ imageLayoutVersion: "1.0.0" }), "utf8");

    await execFileAsync("tar", ["--format=ustar", "--numeric-owner", "--owner=0", "--group=0", "-C", pack, "-cf", outPath, "blobs", "index.json", "manifest.json", "oci-layout", "repositories"]);
    const stat = await fs.stat(outPath);
    return { path: outPath, filename: nasImageFile(format, goarch), size: stat.size };
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

/** Read a previously built NAS image (building it if missing), confined to BUILD_DIR. */
export async function readNasImage(arch: string, version: string, format: NasFormat = "qnap"): Promise<{ buf: Buffer; filename: string }> {
  assertTarget("linux", arch);
  const goarch = arch as AgentArch;
  const path = join(nasImageDir(version, goarch), nasImageFile(format, goarch));
  try {
    await fs.access(path);
  } catch {
    await buildNasImage(goarch, version, format);
  }
  return { buf: await fs.readFile(path), filename: nasImageFile(format, goarch) };
}

/** Resolve the newest build for a target (for agent self-update); null if none. */
export async function latestBuildFor(os: string, arch: string): Promise<BuildMeta | null> {
  if (!(ALLOWED_OS as readonly string[]).includes(os) || !(ALLOWED_ARCH as readonly string[]).includes(arch)) return null;
  const all = await listBuilds();
  return all.find((b) => b.os === os && b.arch === arch) ?? null; // listBuilds is newest-first
}

/**
 * Ensure a build exists for the given version across the full platform matrix —
 * builds any missing ones so every platform is downloadable after each change.
 * Best-effort: failures are collected and returned, never thrown.
 */
export async function ensureAllBuilds(version: string): Promise<{ built: string[]; failed: Array<{ target: string; error: string }> }> {
  const built: string[] = [];
  const failed: Array<{ target: string; error: string }> = [];
  for (const os of ALLOWED_OS) {
    for (const arch of ALLOWED_ARCH) {
      const target = `${os}-${arch}`;
      try {
        await fs.access(join(buildDir(version, os, arch), binaryName(os)));
        continue; // already present
      } catch {
        // missing → build it
      }
      try {
        await buildAgent(os, arch, version);
        built.push(target);
      } catch (err) {
        failed.push({ target, error: err instanceof Error ? err.message : "unknown" });
      }
    }
  }
  // Also build the NAS/container images (each format × arch) alongside the installers.
  for (const arch of ALLOWED_ARCH) {
    for (const format of NAS_FORMATS) {
      const target = `nas-${format}-${arch}`;
      try {
        await fs.access(join(nasImageDir(version, arch), nasImageFile(format, arch)));
        continue; // already present
      } catch {
        /* missing → build it */
      }
      try {
        await buildNasImage(arch, version, format);
        built.push(target);
      } catch (err) {
        failed.push({ target, error: err instanceof Error ? err.message : "unknown" });
      }
    }
  }
  return { built, failed };
}
