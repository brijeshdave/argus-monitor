/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * SNMP profile service — CRUD over the "MIB master" (snmp_profiles). System
 * profiles (seeded built-ins) are protected from edit/delete. A profile drives what
 * an SNMP monitor collects: `standard` toggles HOST-RESOURCES/IF-MIB health and
 * `oids` adds vendor-specific scalar readings.
 */
import { eq } from "drizzle-orm";
import { snmpProfiles, type MasterDb } from "@argus/db";
import type { SnmpProfileDTO, SnmpProfileInput, SnmpProfileOid, SnmpProfileTable } from "@argus/shared";

type Row = typeof snmpProfiles.$inferSelect;

const toDTO = (r: Row): SnmpProfileDTO => ({
  id: r.id,
  name: r.name,
  vendor: r.vendor,
  deviceType: r.deviceType,
  model: r.model,
  standard: r.standard,
  oids: (r.oids ?? []) as SnmpProfileOid[],
  tables: (r.tables ?? []) as SnmpProfileTable[],
  isSystem: r.isSystem,
});

const cleanOids = (oids?: SnmpProfileOid[]): SnmpProfileOid[] =>
  (oids ?? [])
    .filter((o) => typeof o?.oid === "string" && /^\.?\d+(\.\d+)*$/.test(o.oid))
    .map((o) => ({ label: String(o.label ?? o.oid), oid: o.oid, unit: o.unit || undefined, group: o.group || undefined }));

const cleanTables = (tables?: SnmpProfileTable[]): SnmpProfileTable[] =>
  (tables ?? [])
    .filter((t) => typeof t?.oid === "string" && /^\.?\d+(\.\d+)*$/.test(t.oid) && Array.isArray(t.columns))
    .map((t) => ({
      name: String(t.name ?? "Table"),
      oid: t.oid,
      columns: t.columns.filter((c) => Number.isInteger(c?.col)).map((c) => ({ label: String(c.label ?? `col${c.col}`), col: c.col, unit: c.unit || undefined, enum: c.enum && typeof c.enum === "object" ? c.enum : undefined })),
    }));

export async function listSnmpProfiles(db: MasterDb): Promise<SnmpProfileDTO[]> {
  const rows = await db.select().from(snmpProfiles);
  return rows.map(toDTO).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSnmpProfile(db: MasterDb, id: string): Promise<SnmpProfileDTO | undefined> {
  const [row] = await db.select().from(snmpProfiles).where(eq(snmpProfiles.id, id)).limit(1);
  return row ? toDTO(row) : undefined;
}

export async function createSnmpProfile(db: MasterDb, input: SnmpProfileInput): Promise<SnmpProfileDTO> {
  const [row] = await db
    .insert(snmpProfiles)
    .values({
      name: input.name.trim(),
      vendor: input.vendor?.trim() ?? "",
      deviceType: input.deviceType?.trim() || "generic",
      model: input.model?.trim() ?? "",
      standard: input.standard ?? true,
      oids: cleanOids(input.oids),
      tables: cleanTables(input.tables),
    })
    .returning();
  if (!row) throw new Error("failed to create profile");
  return toDTO(row);
}

/** Update a profile; throws if it's a protected system profile. */
export async function updateSnmpProfile(db: MasterDb, id: string, input: SnmpProfileInput): Promise<SnmpProfileDTO | undefined> {
  const existing = await getSnmpProfile(db, id);
  if (!existing) return undefined;
  if (existing.isSystem) throw new Error("system profile is read-only");
  const [row] = await db
    .update(snmpProfiles)
    .set({
      name: input.name.trim(),
      vendor: input.vendor?.trim() ?? "",
      deviceType: input.deviceType?.trim() || "generic",
      model: input.model?.trim() ?? "",
      standard: input.standard ?? true,
      oids: cleanOids(input.oids),
      tables: cleanTables(input.tables),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(snmpProfiles.id, id))
    .returning();
  return row ? toDTO(row) : undefined;
}

/** Delete a profile; throws if it's a protected system profile. Returns success. */
export async function deleteSnmpProfile(db: MasterDb, id: string): Promise<boolean> {
  const existing = await getSnmpProfile(db, id);
  if (!existing) return false;
  if (existing.isSystem) throw new Error("system profile cannot be deleted");
  await db.delete(snmpProfiles).where(eq(snmpProfiles.id, id));
  return true;
}
