/**
 * Argus — Monitoring Platform · Author: Brijesh Dave <https://github.com/brijeshdave>
 * Drizzle-kit config for the MASTER database (identity, RBAC, config, secrets).
 * Single dialect: PostgreSQL (PGlite for embedded dev/test, server for prod).
 */
import { defineConfig } from "drizzle-kit";

// Schema is read from the COMPILED output (real .js files) so drizzle-kit's
// loader resolves intra-package imports correctly. Run `pnpm build` first
// (the `generate` script does this for you).
export default defineConfig({
  schema: "./dist/master/schema.js",
  out: "./migrations/master",
  dialect: "postgresql",
  dbCredentials: { url: process.env.MASTER_DATABASE_URL ?? "postgres://argus:argus@localhost:5432/argus_master" },
  verbose: true,
  strict: true,
});
