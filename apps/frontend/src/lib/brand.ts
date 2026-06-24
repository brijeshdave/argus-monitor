/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * White-label brand config — the single source of truth for the product name and
 * tagline. This is intentionally **deploy-time only**: the values come from build
 * environment variables (VITE_BRAND_NAME / VITE_BRAND_TAGLINE) with sensible
 * defaults. There is deliberately NO in-app setting and NO permission to change
 * branding, so the product identity cannot be altered by any operator at runtime.
 */
const env = import.meta.env as Record<string, string | undefined>;

export const BRAND = {
  name: env.VITE_BRAND_NAME?.trim() || "Argus",
  tagline: env.VITE_BRAND_TAGLINE?.trim() || "Monitoring",
} as const;
