/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Seeds built-in SNMP profiles (the "MIB master"). Each profile is keyed by vendor /
 * device type / model. `standard` enables the HOST-RESOURCES + IF-MIB collection
 * (uptime/CPU/RAM/volumes/NICs); `oids` adds vendor-specific scalar readings. System
 * profiles are protected (no edit/delete) and seeded idempotently by name.
 */
import { eq, inArray } from "drizzle-orm";
import type { MasterDb } from "@/master/index.js";
import { snmpProfiles } from "@/master/schema.js";

type Oid = { label: string; oid: string; unit?: string; group?: string };
type Table = { name: string; oid: string; columns: Array<{ label: string; col: number; unit?: string; enum?: Record<string, string> }> };
interface BuiltinProfile {
  name: string;
  vendor: string;
  deviceType: string;
  model: string;
  standard: boolean;
  oids: Oid[];
  tables?: Table[];
}

export const BUILTIN_SNMP_PROFILES: BuiltinProfile[] = [
  { name: "Standard (any device)", vendor: "Standard", deviceType: "generic", model: "", standard: true, oids: [] },
  {
    name: "QNAP NAS",
    vendor: "QNAP",
    deviceType: "nas",
    model: "",
    standard: true,
    // Classic QNAP enterprise MIB (1.3.6.1.4.1.24681). Exact OIDs vary by model/QTS —
    // clone this profile per model and adjust as needed.
    oids: [
      { label: "CPU usage", oid: "1.3.6.1.4.1.24681.1.2.1.0", group: "QNAP" },
      { label: "CPU temperature", oid: "1.3.6.1.4.1.24681.1.2.5.0", unit: "°C", group: "QNAP" },
      { label: "System temperature", oid: "1.3.6.1.4.1.24681.1.2.6.0", unit: "°C", group: "QNAP" },
      { label: "Free memory", oid: "1.3.6.1.4.1.24681.1.2.2.0", unit: "MB", group: "QNAP" },
      { label: "Total memory", oid: "1.3.6.1.4.1.24681.1.2.3.0", unit: "MB", group: "QNAP" },
      { label: "System fan speed", oid: "1.3.6.1.4.1.24681.1.2.15.0", unit: "RPM", group: "QNAP" },
    ],
  },
  {
    // QuTS hero / QTS 5 use the newer QNAP MIB tree (1.3.6.1.4.1.55062) — classic 24681
    // OIDs don't apply. Standard HOST-RESOURCES/IF-MIB gives CPU/RAM/volumes/NICs; use the
    // "Browse device" tool to add this model's 55062 temps/fans/disks.
    name: "QNAP QuTS hero (QTS 5)",
    vendor: "QNAP",
    deviceType: "nas",
    model: "",
    standard: true,
    // QuTS hero runs net-snmp → CPU/mem via UCD-SNMP-MIB (1.3.6.1.4.1.2021).
    oids: [
      { label: "Load 1m", oid: "1.3.6.1.4.1.2021.10.1.3.1", group: "System" },
      { label: "Load 5m", oid: "1.3.6.1.4.1.2021.10.1.3.2", group: "System" },
      { label: "Load 15m", oid: "1.3.6.1.4.1.2021.10.1.3.3", group: "System" },
      { label: "Total RAM", oid: "1.3.6.1.4.1.2021.4.5.0", unit: "KB", group: "Memory" },
      { label: "Available RAM", oid: "1.3.6.1.4.1.2021.4.6.0", unit: "KB", group: "Memory" },
    ],
    // QuTS hero storage tables (enterprise 55062.2.10) — per-disk/raid/pool rows.
    tables: [
      {
        name: "Disks",
        oid: "1.3.6.1.4.1.55062.2.10.2.1",
        columns: [
          { label: "Slot", col: 1 },
          { label: "Model", col: 4 },
          { label: "Type", col: 6 },
          { label: "Status", col: 7 },
          { label: "Temp", col: 8, unit: "°C" },
          { label: "Capacity", col: 9, unit: "bytes" },
        ],
      },
      {
        name: "RAID",
        oid: "1.3.6.1.4.1.55062.2.10.5.1",
        columns: [
          { label: "Name", col: 3 },
          { label: "Status", col: 4 },
          { label: "Level", col: 7 },
          { label: "Capacity", col: 5, unit: "bytes" },
        ],
      },
      {
        name: "Storage pools",
        oid: "1.3.6.1.4.1.55062.2.10.7.1",
        columns: [
          { label: "Pool", col: 2 },
          { label: "Status", col: 5, enum: { "-3": "error", "-2": "notReady", "-1": "warning", "0": "ready" } },
          { label: "Capacity", col: 3, unit: "bytes" },
          { label: "Free", col: 4, unit: "bytes" },
        ],
      },
      {
        name: "Shares",
        oid: "1.3.6.1.4.1.55062.2.10.9.1",
        columns: [
          { label: "Name", col: 2 },
          { label: "Status", col: 5 },
          { label: "Capacity", col: 3, unit: "bytes" },
          { label: "Free", col: 4, unit: "bytes" },
          { label: "WORM", col: 7, enum: { "0": "off", "1": "on" } },
          { label: "Compression", col: 8, enum: { "0": "off", "1": "on" } },
          { label: "Dedup", col: 9, enum: { "0": "off", "1": "on" } },
          { label: "Encryption", col: 11, enum: { "0": "off", "1": "on" } },
        ],
      },
    ],
  },
  { name: "TrueNAS / Unix (net-snmp)", vendor: "TrueNAS", deviceType: "nas", model: "", standard: true, oids: [] },
  { name: "Network switch (IF-MIB)", vendor: "Generic", deviceType: "switch", model: "", standard: true, oids: [] },
  {
    name: "UPS (UPS-MIB / RFC 1628)",
    vendor: "Generic",
    deviceType: "ups",
    model: "",
    standard: false,
    oids: [
      { label: "Battery status", oid: "1.3.6.1.2.1.33.1.2.1.0", group: "Battery" },
      { label: "Seconds on battery", oid: "1.3.6.1.2.1.33.1.2.2.0", unit: "s", group: "Battery" },
      { label: "Minutes remaining", oid: "1.3.6.1.2.1.33.1.2.3.0", unit: "min", group: "Battery" },
      { label: "Battery charge", oid: "1.3.6.1.2.1.33.1.2.4.0", unit: "%", group: "Battery" },
      { label: "Input voltage", oid: "1.3.6.1.2.1.33.1.3.3.1.3.1", unit: "V", group: "Power" },
      { label: "Output load", oid: "1.3.6.1.2.1.33.1.4.4.1.5.1", unit: "%", group: "Power" },
    ],
  },
];

export async function seedSnmpProfiles(db: MasterDb): Promise<void> {
  const names = BUILTIN_SNMP_PROFILES.map((p) => p.name);
  const existing = new Map(
    (await db.select({ id: snmpProfiles.id, name: snmpProfiles.name }).from(snmpProfiles).where(inArray(snmpProfiles.name, names))).map((r) => [r.name, r.id]),
  );
  // Insert missing built-ins; refresh existing ones (keep their id so monitors that
  // reference a built-in profile stay valid) so OID/table updates ship on re-seed.
  for (const p of BUILTIN_SNMP_PROFILES) {
    const fields = { vendor: p.vendor, deviceType: p.deviceType, model: p.model, standard: p.standard, oids: p.oids, tables: p.tables ?? [] };
    const id = existing.get(p.name);
    if (id) await db.update(snmpProfiles).set(fields).where(eq(snmpProfiles.id, id));
    else await db.insert(snmpProfiles).values({ name: p.name, isSystem: true, ...fields });
  }
}
