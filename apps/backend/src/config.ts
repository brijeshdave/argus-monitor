/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Typed, validated runtime configuration. Every value has a safe default so the
 * app boots out-of-the-box; production hardening is opt-in via env. Validation
 * happens once at startup so misconfiguration fails fast and loudly.
 */
import { z } from "zod";

const ConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().positive().default(8080),
  publicUrl: z.string().default("http://localhost:8081"),
  trustProxy: z.string().optional(),

  redisEnabled: z.coerce.boolean().default(false),
  redisUrl: z.string().default("redis://localhost:6379"),

  // Auth / tokens
  jwtSecret: z.string().default("change-me-in-production"),
  accessTtl: z.string().default("12h"), // JWT expiresIn; 12h so a shift doesn't get logged out. Override via JWT_ACCESS_TTL.
  refreshTtlSec: z.coerce.number().int().positive().default(7 * 24 * 60 * 60),
  adminToken: z.string().optional(), // static superadmin token for CLI/automation
  rateLimitMax: z.coerce.number().int().positive().default(600),

  // OIDC (generic, optional)
  oidcEnabled: z.coerce.boolean().default(false),
  oidcIssuer: z.string().optional(),
  oidcClientId: z.string().optional(),
  oidcClientSecret: z.string().optional(),
  oidcRedirectUri: z.string().optional(),

  otelEnabled: z.coerce.boolean().default(false),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

/** Parse a duration like "15m", "7d", "3600s" into seconds. */
export function durationToSeconds(value: string, fallback: number): number {
  const m = /^(\d+)\s*(s|m|h|d)?$/.exec(value.trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  const unit = m[2] ?? "s";
  const mult = unit === "d" ? 86400 : unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  return n * mult;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return ConfigSchema.parse({
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    host: env.BACKEND_HOST,
    port: env.BACKEND_PORT,
    publicUrl: env.PUBLIC_URL,
    trustProxy: env.TRUST_PROXY,
    redisEnabled: env.REDIS_ENABLED,
    redisUrl: env.REDIS_URL,
    jwtSecret: env.JWT_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtlSec: env.JWT_REFRESH_TTL ? durationToSeconds(env.JWT_REFRESH_TTL, 7 * 24 * 60 * 60) : undefined,
    adminToken: env.ADMIN_TOKEN,
    rateLimitMax: env.RATE_LIMIT_MAX,
    oidcEnabled: env.OIDC_ENABLED,
    oidcIssuer: env.OIDC_ISSUER,
    oidcClientId: env.OIDC_CLIENT_ID,
    oidcClientSecret: env.OIDC_CLIENT_SECRET,
    oidcRedirectUri: env.OIDC_REDIRECT_URI,
    otelEnabled: env.OTEL_ENABLED,
  });
}
