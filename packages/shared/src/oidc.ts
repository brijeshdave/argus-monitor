/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * OIDC provider admin contracts. Multiple providers can be configured and enabled
 * independently; each renders its own button on the login page. The client secret
 * is write-only — sent on create/update but NEVER returned (DTOs expose only
 * `hasSecret`).
 */

/** Known provider brands (drive the login button icon/label; "generic" = plain). */
export const OIDC_BRANDS = ["generic", "google", "microsoft", "authentik", "auth0", "clerk", "okta", "keycloak", "github", "gitlab"] as const;
export type OidcBrand = (typeof OIDC_BRANDS)[number];

export interface OidcProviderDTO {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  enabled: boolean;
  /** Brand for the login button (icon/label); defaults to "generic". */
  brand: OidcBrand;
  /** Whether a client secret is stored (the value itself is never serialized). */
  hasSecret: boolean;
  /** The exact callback URL to register at the IdP (derived from PUBLIC_URL). */
  redirectUri: string;
  createdAt: string;
}

export interface CreateOidcProviderRequest {
  name: string;
  issuer: string;
  clientId: string;
  clientSecret?: string;
  enabled?: boolean;
  brand?: OidcBrand;
}

export type UpdateOidcProviderRequest = Partial<CreateOidcProviderRequest>;

/** One enabled provider as exposed (unauthenticated) to the login page. */
export interface PublicOidcProvider {
  id: string;
  name: string;
  brand: OidcBrand;
  /** Relative URL the browser navigates to in order to start this provider's flow. */
  loginUrl: string;
}

/**
 * Starter templates for common IdPs. `issuer` may contain a placeholder the
 * operator edits (tenant/domain/realm); everything else is prefilled.
 */
export interface OidcTemplate {
  key: OidcBrand;
  name: string;
  brand: OidcBrand;
  issuer: string;
  /** Short setup hint shown in the admin UI. */
  hint: string;
}

export const OIDC_TEMPLATES: OidcTemplate[] = [
  { key: "google", name: "Google", brand: "google", issuer: "https://accounts.google.com", hint: "Create an OAuth 2.0 Client (Web) in Google Cloud → Credentials." },
  { key: "microsoft", name: "Microsoft", brand: "microsoft", issuer: "https://login.microsoftonline.com/common/v2.0", hint: "Replace 'common' with your tenant ID for single-tenant. Register an app in Entra ID." },
  { key: "authentik", name: "Authentik", brand: "authentik", issuer: "https://authentik.example.com/application/o/<app-slug>/", hint: "Use the issuer from your Authentik OIDC provider's configuration URL." },
  { key: "auth0", name: "Auth0", brand: "auth0", issuer: "https://YOUR_TENANT.us.auth0.com", hint: "Issuer is your Auth0 domain (https://, trailing slash optional)." },
  { key: "clerk", name: "Clerk", brand: "clerk", issuer: "https://your-domain.clerk.accounts.dev", hint: "Use your Clerk Frontend API / issuer URL." },
  { key: "okta", name: "Okta", brand: "okta", issuer: "https://YOUR_ORG.okta.com", hint: "Issuer is your Okta org URL (or an Authorization Server issuer)." },
  { key: "keycloak", name: "Keycloak", brand: "keycloak", issuer: "https://keycloak.example.com/realms/<realm>", hint: "Issuer is the realm URL: .../realms/<realm>." },
  { key: "generic", name: "Generic OIDC", brand: "generic", issuer: "", hint: "Any OIDC issuer with discovery (/.well-known/openid-configuration)." },
];
