/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * SNMP client (server-side, no agent). Driven by an SNMP profile: when `standard`
 * is set it collects the universal HOST-RESOURCES + IF-MIB health (uptime, CPU %,
 * RAM %, storage volumes, NICs with MAC/IP and rx/tx throughput from counter
 * deltas); profile `oids` add vendor-specific scalar readings (e.g. QNAP temps).
 * Ported from the proven v1 collector. SNMP v1/v2c; v3 is a future add.
 */
import snmp, { type Session, type Varbind } from "net-snmp";
import type { SnmpDisk, SnmpItem, SnmpNic, SnmpProfileTable, SnmpSample, SnmpTable, SnmpVolume } from "@argus/shared";

export interface ProfileOid {
  label: string;
  oid: string;
  unit?: string;
  group?: string;
}
export interface SnmpProfileLite {
  standard: boolean;
  oids: ProfileOid[];
  tables?: SnmpProfileTable[];
  vendor?: string;
}

// QNAP enterprise HdTable (classic NAS MIB) — physical disk health/temperature.
const QNAP_HD = {
  descr: "1.3.6.1.4.1.24681.1.2.11.1.2",
  temp: "1.3.6.1.4.1.24681.1.2.11.1.3",
  status: "1.3.6.1.4.1.24681.1.2.11.1.4",
  model: "1.3.6.1.4.1.24681.1.2.11.1.5",
  smart: "1.3.6.1.4.1.24681.1.2.11.1.7",
} as const;

// HOST-RESOURCES / IF-MIB OIDs (works on QNAP/TrueNAS/Unix/switches).
const OID = {
  sysUpTime: "1.3.6.1.2.1.1.3.0",
  hrProcLoad: "1.3.6.1.2.1.25.3.3.1.2",
  hrStorageType: "1.3.6.1.2.1.25.2.3.1.2",
  hrStorageDescr: "1.3.6.1.2.1.25.2.3.1.3",
  hrStorageSize: "1.3.6.1.2.1.25.2.3.1.5",
  hrStorageUsed: "1.3.6.1.2.1.25.2.3.1.6",
  typeRAM: "1.3.6.1.2.1.25.2.1.2",
  typeFixed: "1.3.6.1.2.1.25.2.1.4",
  ifType: "1.3.6.1.2.1.2.2.1.3",
  ifDescr: "1.3.6.1.2.1.2.2.1.2",
  ifPhys: "1.3.6.1.2.1.2.2.1.6",
  ifHCIn: "1.3.6.1.2.1.31.1.1.1.6",
  ifHCOut: "1.3.6.1.2.1.31.1.1.1.10",
  ifIn: "1.3.6.1.2.1.2.2.1.10", // 32-bit fallback (Counter64 HC often dropped under poll)
  ifOut: "1.3.6.1.2.1.2.2.1.16",
  ipAdEntIf: "1.3.6.1.2.1.4.20.1.2",
} as const;

const HOST_RE = /^[a-zA-Z0-9.\-:]{1,253}$/;
const OID_RE = /^\.?\d+(\.\d+)*$/;

/** Per-(host:ifIndex) octet-counter cache → bytes/sec across polls. */
const nicCache = new Map<string, { in: bigint; out: bigint; at: number }>();

const lastIndex = (oid: string): number => Number(oid.slice(oid.lastIndexOf(".") + 1)) || 0;

function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (Buffer.isBuffer(v)) return v.length ? BigInt(`0x${v.toString("hex")}`) : 0n;
  const n = Number(v);
  return Number.isFinite(n) ? BigInt(Math.trunc(n)) : 0n;
}
const toNum = (v: unknown): number => Number(toBigInt(v));

function renderScalar(value: unknown): string {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

function formatMac(v: unknown): string {
  if (!Buffer.isBuffer(v) || v.length === 0 || v.every((b) => b === 0)) return "";
  return Array.from(v).map((b) => b.toString(16).padStart(2, "0")).join(":");
}

const isPseudoMount = (n: string): boolean =>
  n.includes(".sock") || n.includes(".lock") || n.includes("/.") || ["/dev", "/proc", "/sys"].some((p) => n.startsWith(p));

/** Promise wrapper over an SNMP GET (per-varbind errors → empty string). */
function get(session: Session, oids: string[]): Promise<Map<string, unknown>> {
  return new Promise((resolve) => {
    session.get(oids, (err, vbs) => {
      const out = new Map<string, unknown>();
      if (!err && vbs) for (const vb of vbs) if (!snmp.isVarbindError(vb)) out.set(vb.oid, vb.value);
      resolve(out);
    });
  });
}

/** Promise wrapper over an SNMP walk (subtree) → index→value map. */
function walk(session: Session, base: string): Promise<Map<number, unknown>> {
  return new Promise((resolve) => {
    const out = new Map<number, unknown>();
    session.subtree(
      base,
      (vbs) => { for (const vb of vbs) if (!snmp.isVarbindError(vb)) out.set(lastIndex(vb.oid), vb.value); },
      () => resolve(out),
    );
  });
}

export function snmpCollect(
  host: string,
  opts: {
    community?: string;
    version?: string;
    profile: SnmpProfileLite;
    timeoutMs?: number;
    /**
     * Walk the EXPENSIVE parts (vendor disk table + profile tables). Default true.
     * Set false for a light poll: reachability + standard/scalar OIDs only — a couple
     * of round trips instead of a full multi-walk, so slow devices (QNAP) aren't
     * starved by a fast cadence. The scheduler runs the heavy walk less often.
     */
    includeTables?: boolean;
  },
): Promise<SnmpSample> {
  return new Promise((resolve) => {
    if (!HOST_RE.test(host)) return resolve({ reachable: false, error: "invalid host" });
    const version = opts.version === "1" ? snmp.Version1 : snmp.Version2c;
    let session: Session;
    try {
      // Per-op timeout is generous: QNAP computes byte-capacity Counter64s on demand
      // (multi-second), so a short timeout drops them mid-poll. Overall budget caps it.
      session = snmp.createSession(host, opts.community || "public", { version, timeout: 8000, retries: 1 });
    } catch (err) {
      return resolve({ reachable: false, error: err instanceof Error ? err.message : "session error" });
    }

    // The sample is filled in place so a slow full collection (many tables) can still
    // return partial data — and crucially, once sysUpTime confirms reachability, a
    // timeout must NOT flip the device to DOWN.
    const sample: SnmpSample = { reachable: false };
    let settled = false;
    const finish = (s: SnmpSample) => {
      if (settled) return;
      settled = true;
      try { session.close(); } catch { /* ignore */ }
      resolve(s);
    };
    // Overall budget across all walks (interval is 60s; tables can be many round-trips).
    setTimeout(() => { if (!sample.reachable) sample.error = "timeout"; finish(sample); }, opts.timeoutMs ?? 40_000).unref?.();

    void (async () => {
      try {
        const up = await get(session, [OID.sysUpTime]);
        const ticks = up.get(OID.sysUpTime);
        if (ticks == null) return finish({ reachable: false, error: "no response (check community / SNMP enabled / firewall)" });
        sample.reachable = true;
        sample.uptimeMin = toNum(ticks) / 100 / 60;

        // Collect groups sequentially — a single SNMP session is unreliable under
        // heavy concurrency (drops walks). Reachability is already sticky and the
        // budget is generous, so sequential is safe and accurate.
        if (opts.profile.standard) await collectStandard(session, host, sample);

        const customOids = opts.profile.oids.filter((o) => OID_RE.test(o.oid));
        if (customOids.length) {
          const vals = await get(session, customOids.map((o) => o.oid));
          const items: SnmpItem[] = [];
          for (const o of customOids) {
            const v = vals.get(o.oid);
            if (v != null) items.push({ label: o.label, oid: o.oid, value: renderScalar(v), unit: o.unit, group: o.group });
          }
          if (items.length) sample.items = items;
        }

        // ── Expensive phase: many sequential walks. Skipped on a light poll so a
        // slow device is not hammered every cycle (the scheduler runs this on its
        // own, slower cadence and carries the last result forward for display).
        if (opts.includeTables !== false) {
          // Classic QNAP HdTable (24681) only when the profile has no disk table of its
          // own — QuTS hero uses the 55062 tables, so this avoids wasted walks/load.
          if ((opts.profile.vendor ?? "").toUpperCase() === "QNAP" && !(opts.profile.tables?.length)) {
            const disks = await collectQnapDisks(session);
            if (disks.length) sample.disks = disks;
          }

          const tables: SnmpTable[] = [];
          for (const t of opts.profile.tables ?? []) {
            const tbl = await collectTable(session, t);
            if (tbl.rows.length) tables.push(tbl);
          }
          if (tables.length) sample.tables = tables;
        }

        finish(sample);
      } catch (err) {
        sample.error = err instanceof Error ? err.message : "collect error";
        finish(sample);
      }
    })();
  });
}

/** HOST-RESOURCES (CPU/RAM/volumes) + IF-MIB (NICs + throughput). */
async function collectStandard(session: Session, host: string, sample: SnmpSample): Promise<void> {
  const loads = await walk(session, OID.hrProcLoad);
  if (loads.size) {
    let sum = 0;
    for (const v of loads.values()) sum += toNum(v);
    sample.cpuPercent = sum / loads.size;
  }

  const [types, descrs, sizes, used] = await Promise.all([
    walk(session, OID.hrStorageType),
    walk(session, OID.hrStorageDescr),
    walk(session, OID.hrStorageSize),
    walk(session, OID.hrStorageUsed),
  ]);
  const volumes: SnmpVolume[] = [];
  for (const [idx, typ] of types) {
    const size = toNum(sizes.get(idx));
    const u = toNum(used.get(idx));
    if (!size || size <= 0) continue;
    const pct = (u / size) * 100;
    const t = String(typ).replace(/^\./, "");
    if (t === OID.typeRAM) sample.memUsedPct = pct;
    else if (t === OID.typeFixed) {
      const name = renderScalar(descrs.get(idx) ?? "").trim() || `vol${idx}`;
      if (!isPseudoMount(name)) volumes.push({ name, usedPct: Math.round(pct * 10) / 10 });
    }
  }
  if (volumes.length) sample.volumes = volumes;

  const [ifTypes, ifDescr, ifMac, hcIn, hcOut, in32, out32, ipMap] = await Promise.all([
    walk(session, OID.ifType),
    walk(session, OID.ifDescr),
    walk(session, OID.ifPhys),
    walk(session, OID.ifHCIn),
    walk(session, OID.ifHCOut),
    walk(session, OID.ifIn),
    walk(session, OID.ifOut),
    ipsByIf(session),
  ]);
  const now = Date.now();
  const nics: SnmpNic[] = [];
  // Iterate the interface LIST (ifDescr/ifType), not the octet counters — those are
  // Counter64 (HC) which this agent may drop, which would otherwise hide every NIC.
  const ifIdx = new Set<number>([...ifDescr.keys(), ...ifTypes.keys(), ...ipMap.keys()]);
  for (const idx of [...ifIdx].sort((a, b) => a - b)) {
    if (toNum(ifTypes.get(idx)) === 24) continue; // loopback
    const name = renderScalar(ifDescr.get(idx) ?? "").trim() || `if${idx}`;
    const inB = toBigInt(hcIn.get(idx) ?? in32.get(idx) ?? 0);
    const outB = toBigInt(hcOut.get(idx) ?? out32.get(idx) ?? 0);
    const key = `${host}:${idx}`;
    const prev = nicCache.get(key);
    if (inB > 0n || outB > 0n) nicCache.set(key, { in: inB, out: outB, at: now });
    let rxBps: number | null = null;
    let txBps: number | null = null;
    if (prev && now > prev.at && (inB > 0n || outB > 0n)) {
      const dt = (now - prev.at) / 1000;
      if (inB >= prev.in) rxBps = Number(inB - prev.in) / dt;
      if (outB >= prev.out) txBps = Number(outB - prev.out) / dt;
    }
    nics.push({ name, mac: formatMac(ifMac.get(idx)) || null, ips: ipMap.get(idx) ?? [], rxBps, txBps });
  }
  if (nics.length) sample.nics = nics;
}

// Known OID → human name, so browse results are searchable by "cpu/temp/fan/disk/
// interface/memory" even though the device only returns numeric OIDs (no MIB names).
const OID_NAMES: Array<[string, string]> = [
  ["1.3.6.1.2.1.1.1", "sysDescr"],
  ["1.3.6.1.2.1.1.3", "sysUpTime"],
  ["1.3.6.1.2.1.1.5", "sysName"],
  ["1.3.6.1.2.1.1.6", "sysLocation"],
  ["1.3.6.1.2.1.25.3.3.1.2", "CPU load (hrProcessorLoad)"],
  ["1.3.6.1.2.1.25.2.3.1.3", "storage descr (hrStorageDescr)"],
  ["1.3.6.1.2.1.25.2.3.1.5", "storage size (hrStorageSize)"],
  ["1.3.6.1.2.1.25.2.3.1.6", "storage used (hrStorageUsed)"],
  ["1.3.6.1.2.1.2.2.1.2", "interface name (ifDescr)"],
  ["1.3.6.1.2.1.2.2.1.6", "interface MAC (ifPhysAddress)"],
  ["1.3.6.1.2.1.2.2.1.8", "interface status (ifOperStatus)"],
  ["1.3.6.1.2.1.31.1.1.1.6", "interface rx (ifHCInOctets)"],
  ["1.3.6.1.2.1.31.1.1.1.10", "interface tx (ifHCOutOctets)"],
  // QNAP classic enterprise MIB (many QuTS hero units still answer these)
  ["1.3.6.1.4.1.24681.1.2.1", "QNAP CPU usage"],
  ["1.3.6.1.4.1.24681.1.2.2", "QNAP total memory"],
  ["1.3.6.1.4.1.24681.1.2.3", "QNAP free memory"],
  ["1.3.6.1.4.1.24681.1.2.5", "QNAP CPU temperature"],
  ["1.3.6.1.4.1.24681.1.2.6", "QNAP system temperature"],
  ["1.3.6.1.4.1.24681.1.2.11.1.2", "QNAP disk descr"],
  ["1.3.6.1.4.1.24681.1.2.11.1.3", "QNAP disk temperature"],
  ["1.3.6.1.4.1.24681.1.2.11.1.4", "QNAP disk status"],
  ["1.3.6.1.4.1.24681.1.2.11.1.5", "QNAP disk model"],
  ["1.3.6.1.4.1.24681.1.2.15", "QNAP system fan speed"],
];

/** Best-effort friendly name for an OID (longest known prefix + trailing index). */
function oidName(oid: string): string {
  const o = oid.replace(/^\./, "");
  let bestBase = "";
  let label = "";
  for (const [base, name] of OID_NAMES) {
    if ((o === base || o.startsWith(`${base}.`)) && base.length > bestBase.length) {
      bestBase = base;
      label = name;
    }
  }
  if (!label) return "";
  const rest = o.slice(bestBase.length).replace(/^\./, "");
  return rest && rest !== "0" ? `${label} #${rest}` : label;
}

/**
 * Walk a subtree and return every (oid, name, value) row — the discovery/browse tool
 * used to build a profile against a real device. Bounded by `max` and a hard timeout
 * so a huge tree can't hang the request.
 */
export function snmpWalk(
  host: string,
  opts: { community?: string; version?: string; oid: string; max?: number; timeoutMs?: number },
): Promise<{ ok: boolean; rows: Array<{ oid: string; name: string; value: string }>; error?: string }> {
  return new Promise((resolve) => {
    if (!HOST_RE.test(host)) return resolve({ ok: false, rows: [], error: "invalid host" });
    if (!OID_RE.test(opts.oid)) return resolve({ ok: false, rows: [], error: "invalid base OID" });
    const max = Math.min(opts.max ?? 1000, 5000);
    const version = opts.version === "1" ? snmp.Version1 : snmp.Version2c;
    let session: Session;
    try {
      session = snmp.createSession(host, opts.community || "public", { version, timeout: opts.timeoutMs ?? 5000, retries: 1 });
    } catch (err) {
      return resolve({ ok: false, rows: [], error: err instanceof Error ? err.message : "session error" });
    }
    const rows: Array<{ oid: string; name: string; value: string }> = [];
    let settled = false;
    const done = (r: { ok: boolean; rows: typeof rows; error?: string }) => {
      if (settled) return;
      settled = true;
      try { session.close(); } catch { /* ignore */ }
      resolve(r);
    };
    setTimeout(() => done({ ok: rows.length > 0, rows, error: rows.length ? undefined : "timeout" }), (opts.timeoutMs ?? 5000) + 3000).unref?.();
    session.subtree(
      opts.oid,
      (vbs) => { for (const vb of vbs) { if (rows.length >= max) break; if (!snmp.isVarbindError(vb)) rows.push({ oid: vb.oid, name: oidName(vb.oid), value: renderScalar(vb.value).slice(0, 200) }); } },
      (err) => done({ ok: !err || rows.length > 0, rows, error: err ? err.message : undefined }),
    );
  });
}

// SNMP numeric ASN.1 types (Integer, Counter32, Gauge32, TimeTicks, Counter64).
const NUMERIC_TYPES = new Set([2, 65, 66, 67, 70]);

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

/** Render a table cell by its SNMP type — counters/integers as numbers (bytes when
 *  the column is a byte counter), octet-strings as text; enum columns map raw→label. */
function renderCell(type: number, value: unknown, unit?: string, enumMap?: Record<string, string>): string {
  let s: string;
  if (NUMERIC_TYPES.has(type)) {
    const n = toBigInt(value);
    const mapped = enumMap?.[n.toString()];
    if (mapped) return mapped;
    if (unit === "bytes") return fmtBytes(Number(n));
    s = n.toString();
  } else if (Buffer.isBuffer(value)) {
    s = value.toString("utf8");
  } else {
    s = String(value);
  }
  const mappedS = enumMap?.[s];
  if (mappedS) return mappedS;
  return unit && unit !== "bytes" && s ? `${s} ${unit}` : s;
}

/** Walk a single column subtree → varbinds (preserves type). */
function walkCol(session: Session, base: string): Promise<Varbind[]> {
  return new Promise((resolve) => {
    const out: Varbind[] = [];
    session.subtree(
      base,
      (vbs) => { for (const vb of vbs) if (!snmp.isVarbindError(vb)) out.push(vb); },
      () => resolve(out),
    );
  });
}

/** Typed GET over a set of OIDs (chunked) — reliable for Counter64 which some agents
 *  skip in GETBULK responses. Returns oid (no leading dot) → varbind. */
async function getTyped(session: Session, oids: string[]): Promise<Map<string, Varbind>> {
  const out = new Map<string, Varbind>();
  for (let i = 0; i < oids.length; i += 20) {
    const chunk = oids.slice(i, i + 20);
    const part = await new Promise<Varbind[]>((resolve) => session.get(chunk, (err, vbs) => resolve(!err && vbs ? vbs : [])));
    for (const vb of part) if (!snmp.isVarbindError(vb)) out.set(vb.oid.replace(/^\./, ""), vb);
  }
  return out;
}

/**
 * Walk a profile-defined table → per-row grid. Walks each column (reliable for most
 * types), then fetches any missing cells with a plain GET — some agents (QuTS hero)
 * omit Counter64 columns from GETBULK, so capacity/free need GET to come through.
 */
async function collectTable(session: Session, t: SnmpProfileTable): Promise<SnmpTable> {
  const cols = t.columns.filter((c) => OID_RE.test(`${t.oid}.${c.col}`));
  const wantCols = new Set(cols.map((c) => c.col));
  const base = t.oid.replace(/^\./, "");
  const byRow = new Map<string, Map<number, Varbind>>(); // rowIndex → (col → varbind)

  // One light subtree of the whole table entry (this agent drops fewer columns this
  // way than per-column walks); bucket varbinds by column + row index.
  for (const vb of await walkCol(session, t.oid)) {
    const o = vb.oid.replace(/^\./, "");
    if (!o.startsWith(`${base}.`)) continue;
    const rest = o.slice(base.length + 1); // "<col>.<rowIndex...>"
    const dot = rest.indexOf(".");
    if (dot === -1) continue;
    const col = Number(rest.slice(0, dot));
    if (!wantCols.has(col)) continue;
    const row = rest.slice(dot + 1);
    if (!byRow.has(row)) byRow.set(row, new Map());
    byRow.get(row)!.set(col, vb);
  }

  // GET-fill any wanted cell still missing (QuTS hero omits Counter64 from GETBULK).
  const rowKeys = [...byRow.keys()];
  const missing: string[] = [];
  for (const rk of rowKeys) for (const c of cols) if (!byRow.get(rk)!.has(c.col)) missing.push(`${base}.${c.col}.${rk}`);
  if (missing.length) {
    const got = await getTyped(session, missing);
    for (const rk of rowKeys) for (const c of cols) {
      if (byRow.get(rk)!.has(c.col)) continue;
      const vb = got.get(`${base}.${c.col}.${rk}`);
      if (vb) byRow.get(rk)!.set(c.col, vb);
    }
  }

  const sorted = rowKeys.sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
  const rows = sorted.map((rk) =>
    cols.map((c) => {
      const vb = byRow.get(rk)!.get(c.col);
      return vb == null ? "" : renderCell(vb.type, vb.value, c.unit, c.enum);
    }),
  );
  return { name: t.name, headers: cols.map((c) => c.label), rows };
}

/** QNAP HdTable → physical disks with status/temperature/model (best-effort). */
async function collectQnapDisks(session: Session): Promise<SnmpDisk[]> {
  const [descr, temp, status, model, smart] = await Promise.all([
    walk(session, QNAP_HD.descr),
    walk(session, QNAP_HD.temp),
    walk(session, QNAP_HD.status),
    walk(session, QNAP_HD.model),
    walk(session, QNAP_HD.smart),
  ]);
  const disks: SnmpDisk[] = [];
  for (const [idx, d] of descr) {
    const name = renderScalar(d).trim() || `Disk ${idx}`;
    // QNAP reports temperature as e.g. "39 C/102 F" — take the leading °C value.
    const tempStr = renderScalar(temp.get(idx) ?? "");
    const tempC = /(-?\d+(?:\.\d+)?)/.exec(tempStr) ? Number(/(-?\d+(?:\.\d+)?)/.exec(tempStr)![1]) : null;
    disks.push({
      name,
      status: status.has(idx) ? renderScalar(status.get(idx)).trim() || null : null,
      tempC,
      model: model.has(idx) ? renderScalar(model.get(idx)).trim() || null : null,
      smart: smart.has(idx) ? renderScalar(smart.get(idx)).trim() || null : null,
    });
  }
  return disks;
}

/** ipAddrTable: ifIndex → bound IPv4 addresses (OID suffix after the base is the IP). */
async function ipsByIf(session: Session): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  const base = OID.ipAdEntIf.replace(/^\./, "");
  await new Promise<void>((resolve) => {
    session.subtree(
      OID.ipAdEntIf,
      (vbs: Varbind[]) => {
        for (const vb of vbs) {
          if (snmp.isVarbindError(vb)) continue;
          const rest = vb.oid.replace(/^\./, "").replace(`${base}.`, "");
          if ((rest.match(/\./g) || []).length !== 3) continue;
          const idx = toNum(vb.value);
          out.set(idx, [...(out.get(idx) ?? []), rest]);
        }
      },
      () => resolve(),
    );
  });
  return out;
}
