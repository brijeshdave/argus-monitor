/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * OIDC provider administration: CRUD over the oidc_providers table with the client
 * secret stored AES-256-GCM-encrypted in the secrets table (never returned).
 * MULTIPLE providers can be enabled at once — each gets its own login + callback
 * route (/api/auth/oidc/:id/{login,callback}) so several IdPs coexist. SSO is
 * configured entirely from the UI; redirect URIs are derived from PUBLIC_URL.
 */
import { and, eq } from "drizzle-orm";
import { oidcProviders, secrets, type MasterDb } from "@argus/db";
import { decryptSecret, encryptSecret, loadKey } from "@argus/core";
import type {
  CreateOidcProviderRequest, OidcBrand, OidcProviderDTO, PublicOidcProvider, UpdateOidcProviderRequest,
} from "@argus/shared";
import { OIDC_BRANDS } from "@argus/shared";
import type { OidcConfig } from "@/services/oidc.js";

type Row = typeof oidcProviders.$inferSelect;

const trimSlash = (u: string) => u.replace(/\/$/, "");

/** The IdP-registered callback URL for a provider (per-provider so several coexist). */
export const redirectUriFor = (publicUrl: string, id: string): string => `${trimSlash(publicUrl)}/api/auth/oidc/${id}/callback`;

const asBrand = (v: string): OidcBrand => ((OIDC_BRANDS as readonly string[]).includes(v) ? (v as OidcBrand) : "generic");

const toDTO = (r: Row, publicUrl: string): OidcProviderDTO => ({
  id: r.id,
  name: r.name,
  issuer: r.issuer,
  clientId: r.clientId,
  enabled: r.enabled,
  brand: asBrand(r.brand),
  hasSecret: Boolean(r.clientSecretRef),
  redirectUri: redirectUriFor(publicUrl, r.id),
  createdAt: r.createdAt,
});

const secretRef = (id: string): string => `oidc:${id}:secret`;

/** Upsert the encrypted client secret for a provider and return its ref. */
async function storeSecret(db: MasterDb, id: string, plaintext: string, encKeyB64: string): Promise<string> {
  const ref = secretRef(id);
  const ciphertext = encryptSecret(plaintext, loadKey(encKeyB64));
  await db
    .insert(secrets)
    .values({ ref, ciphertext })
    .onConflictDoUpdate({ target: secrets.ref, set: { ciphertext, updatedAt: new Date().toISOString() } });
  return ref;
}

export async function listOidcProviders(db: MasterDb, publicUrl: string): Promise<OidcProviderDTO[]> {
  return (await db.select().from(oidcProviders)).map((r) => toDTO(r, publicUrl));
}

export async function createOidcProvider(
  db: MasterDb,
  input: CreateOidcProviderRequest,
  encKeyB64: string,
  publicUrl: string,
): Promise<OidcProviderDTO> {
  const [created] = await db
    .insert(oidcProviders)
    .values({ name: input.name, issuer: input.issuer, clientId: input.clientId, enabled: input.enabled ?? false, brand: asBrand(input.brand ?? "generic") })
    .returning();
  if (!created) throw new Error("failed to create oidc provider");
  if (input.clientSecret) {
    const ref = await storeSecret(db, created.id, input.clientSecret, encKeyB64);
    const [updated] = await db.update(oidcProviders).set({ clientSecretRef: ref }).where(eq(oidcProviders.id, created.id)).returning();
    return toDTO(updated ?? created, publicUrl);
  }
  return toDTO(created, publicUrl);
}

export async function updateOidcProvider(
  db: MasterDb,
  id: string,
  patch: UpdateOidcProviderRequest,
  encKeyB64: string,
  publicUrl: string,
): Promise<OidcProviderDTO | undefined> {
  const set: Partial<typeof oidcProviders.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.issuer !== undefined) set.issuer = patch.issuer;
  if (patch.clientId !== undefined) set.clientId = patch.clientId;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.brand !== undefined) set.brand = asBrand(patch.brand);
  if (patch.clientSecret) set.clientSecretRef = await storeSecret(db, id, patch.clientSecret, encKeyB64);

  const [row] = await db.update(oidcProviders).set(set).where(eq(oidcProviders.id, id)).returning();
  return row ? toDTO(row, publicUrl) : undefined;
}

export async function deleteOidcProvider(db: MasterDb, id: string): Promise<boolean> {
  const [row] = await db.delete(oidcProviders).where(eq(oidcProviders.id, id)).returning();
  if (row?.clientSecretRef) await db.delete(secrets).where(eq(secrets.ref, row.clientSecretRef));
  return Boolean(row);
}

/** Enabled providers (with a stored secret) exposed to the unauthenticated login page. */
export async function listEnabledPublicProviders(db: MasterDb): Promise<PublicOidcProvider[]> {
  const rows = await db.select().from(oidcProviders).where(eq(oidcProviders.enabled, true));
  return rows
    .filter((r) => Boolean(r.clientSecretRef))
    .map((r) => ({ id: r.id, name: r.name, brand: asBrand(r.brand), loginUrl: `/api/auth/oidc/${r.id}/login` }));
}

/**
 * Resolve a single ENABLED provider's login config (issuer + clientId + decrypted
 * secret + its own redirect URI). Null when the provider is missing, disabled, or
 * has no secret — the login route then 404s.
 */
export async function getProviderConfig(db: MasterDb, id: string, encKeyB64: string, publicUrl: string): Promise<OidcConfig | null> {
  const [provider] = await db.select().from(oidcProviders).where(and(eq(oidcProviders.id, id), eq(oidcProviders.enabled, true))).limit(1);
  if (!provider || !provider.clientSecretRef) return null;
  const [secret] = await db.select().from(secrets).where(eq(secrets.ref, provider.clientSecretRef)).limit(1);
  if (!secret) return null;
  return {
    issuer: provider.issuer,
    clientId: provider.clientId,
    clientSecret: decryptSecret(secret.ciphertext, loadKey(encKeyB64)),
    redirectUri: redirectUriFor(publicUrl, id),
  };
}
