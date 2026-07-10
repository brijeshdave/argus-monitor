/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Offline account recovery (`./argus reset-password`). Talks straight to the master
 * database, bypassing the API, so a forgotten or locked-out owner account can always
 * be recovered by someone with shell access to the host.
 *
 * Usage:
 *   ./argus reset-password                          reset the owner, print a new password
 *   ./argus reset-password <username>               reset that user, print a new password
 *   ./argus reset-password <username> <password>    set an explicit password
 *   ./argus reset-password <username> --reset-2fa   also clear TOTP two-factor
 *
 * Always clears any login lockout and bumps tokenVersion, which immediately
 * invalidates every existing session and access token for that account.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createMasterConnection, users } from "@argus/db";
import { hashPassword } from "@argus/core";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const resetTwoFA = argv.includes("--reset-2fa");
  const [usernameArg, passwordArg] = argv.filter((a) => !a.startsWith("--"));

  const { db, close } = createMasterConnection();
  try {
    // Target the named user, or the protected owner when no username is given.
    const [target] = usernameArg
      ? await db.select().from(users).where(eq(users.username, usernameArg)).limit(1)
      : await db.select().from(users).where(eq(users.isOwner, true)).limit(1);

    if (!target) {
      console.error(
        usernameArg
          ? `[reset-password] no such user: "${usernameArg}"`
          : "[reset-password] no owner account found — run `./argus seed` first",
      );
      process.exitCode = 1;
      return;
    }

    const generated = passwordArg ? undefined : randomBytes(12).toString("base64url");
    const password = passwordArg ?? generated!;

    const patch: Partial<typeof users.$inferInsert> = {
      passwordHash: hashPassword(password),
      tokenVersion: target.tokenVersion + 1, // kill every issued token/session
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: new Date().toISOString(),
    };
    if (resetTwoFA) {
      patch.totpEnabled = false;
      patch.totpSecret = null;
      patch.totpRecovery = null;
    }

    await db.update(users).set(patch).where(eq(users.id, target.id));

    console.log(`[reset-password] password reset for "${target.username}"${resetTwoFA ? " (2FA cleared)" : ""}`);
    console.log("[reset-password] existing sessions invalidated; login lockout cleared.");
    if (target.disabled) {
      console.log("[reset-password] ⚠ this account is DISABLED — re-enable it in the UI before it can sign in.");
    }
    if (generated) {
      console.log(`[reset-password] ⚠ new password (store it now, then change it in the UI): ${generated}`);
    }
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error("[reset-password] failed:", err);
  process.exit(1);
});
