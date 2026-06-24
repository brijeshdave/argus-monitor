/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Seed entrypoint. Orchestrates the focused, idempotent seed modules against the
 * master database. Assumes migrations have already run (`./argus migrate`).
 *
 * Usage:  pnpm --filter @argus/db seed   (wired to `./argus seed`)
 */
import { fileURLToPath } from "node:url";
import { createMasterConnection } from "@/master/index.js";
import { seedRbac } from "@/seed/rbac.js";
import { seedOwner } from "@/seed/owner.js";
import { seedRetentionDefaults } from "@/seed/retention.js";
import { seedDefaultWallboard } from "@/seed/wallboard.js";
import { seedSnmpProfiles } from "@/seed/snmp.js";

export async function runSeed(): Promise<void> {
  const { db, close } = createMasterConnection();
  try {
    await seedRbac(db);
    await seedRetentionDefaults(db);
    await seedDefaultWallboard(db);
    await seedSnmpProfiles(db);
    const owner = await seedOwner(db, { password: process.env.ADMIN_PASSWORD });
    // eslint-disable-next-line no-console
    console.log(`[seed] rbac ✓  retention ✓  snmp-profiles ✓  owner ${owner.created ? "created" : "exists"} (${owner.username})`);
    if (owner.generatedPassword) {
      // eslint-disable-next-line no-console
      console.log(`[seed] ⚠ generated owner password (store it now): ${owner.generatedPassword}`);
    }
  } finally {
    await close();
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[seed] failed:", err);
      process.exit(1);
    });
}
