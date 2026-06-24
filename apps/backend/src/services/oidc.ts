/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Generic OIDC (OpenID Connect) helpers — authorization-code flow with PKCE,
 * implemented with the standard discovery document and Node's global fetch (no
 * third-party OIDC dependency). Works with any compliant provider (Entra/Azure AD,
 * Google, Okta, Keycloak, Authentik, …). Federated users are provisioned with NO
 * groups, so they authenticate but have no access until an admin assigns groups.
 */
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { users, type MasterDb } from "@argus/db";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

export interface OidcProfile {
  sub: string;
  email: string | null;
  name: string;
}

const discoveryCache = new Map<string, Discovery>();

/** Fetch (and cache) the provider's OpenID configuration. */
export async function discover(issuer: string): Promise<Discovery> {
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;
  const res = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error("oidc_discovery_failed");
  const doc = (await res.json()) as Discovery;
  discoveryCache.set(issuer, doc);
  return doc;
}

/** Generate a PKCE verifier + S256 challenge pair. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Build the authorization-endpoint redirect URL. */
export function buildAuthUrl(d: Discovery, cfg: OidcConfig, state: string, challenge: string): string {
  const url = new URL(d.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** Exchange an authorization code for tokens and fetch the user profile. */
export async function exchangeCode(d: Discovery, cfg: OidcConfig, code: string, verifier: string): Promise<OidcProfile> {
  const tokenRes = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) throw new Error("oidc_token_exchange_failed");
  const tokens = (await tokenRes.json()) as { access_token: string };

  const userRes = await fetch(d.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` } });
  if (!userRes.ok) throw new Error("oidc_userinfo_failed");
  const info = (await userRes.json()) as { sub: string; email?: string; name?: string; preferred_username?: string };

  return {
    sub: info.sub,
    email: info.email ?? null,
    name: info.name ?? info.preferred_username ?? info.email ?? info.sub,
  };
}

/** Find the local user for an OIDC profile, provisioning one (no groups) on first login. */
export async function findOrProvisionUser(db: MasterDb, profile: OidcProfile): Promise<typeof users.$inferSelect | undefined> {
  const username = `oidc:${profile.sub}`;
  const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(users)
    .values({ username, displayName: profile.name, email: profile.email, authProvider: "oidc" })
    .returning();
  return created;
}
