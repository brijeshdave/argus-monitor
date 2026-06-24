/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Authentication routes: local login, refresh-token rotation, logout, and the
 * current-identity endpoint. Routes stay thin — validation (zod) at the boundary,
 * logic in the auth/subject services.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "@argus/db";
import { hashPassword, verifyPassword } from "@argus/core";
import {
  bumpTokenVersion, checkPassword, findLocalUser, getTokenVersion, issueRefreshToken,
  markLoggedIn, revokeRefreshToken, rotateRefreshToken, toPublicUser, userIdForRefreshToken,
} from "@/services/auth.js";
import {
  clearLock, getLockoutPolicy, isLocked, recordFailure, recordSuccess,
} from "@/services/lockout.js";
import { listSessions, terminateAllForUser, terminateOtherSessions, terminateSession } from "@/services/sessions.js";
import {
  beginSetup, disable, enable, isRequired, verifyForLogin, TwoFAConfigError, TwoFAVerifyError,
} from "@/services/twofa.js";

const credentials = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  code: z.string().optional(), // second factor (TOTP or recovery code)
});
const codeBody = z.object({ code: z.string().min(1) });
const refreshBody = z.object({ refreshToken: z.string().min(1) });
const profileBody = z.object({
  displayName: z.string().optional(),
  email: z.string().email().nullable().optional(),
});
const passwordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (req, reply) => {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const user = await findLocalUser(app.master, parsed.data.username);
    if (!user) return reply.code(401).send({ error: "invalid_credentials" });

    // Per-account lockout: a locked account is rejected before any password work,
    // so consecutive failures can't be used to keep the lock alive indefinitely.
    if (isLocked(user)) {
      return reply.code(423).send({ error: "account_locked", until: user.lockedUntil });
    }

    // Wrong password → record a failure (which may trip the lock) and 401. We keep
    // the response uniform whether or not this attempt happened to cause the lock.
    if (!checkPassword(user, parsed.data.password)) {
      await recordFailure(app.master, user, await getLockoutPolicy(app.master));
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    // Second factor: enforced only after the password has verified, so we never
    // reveal whether 2FA is enabled to an unauthenticated guesser.
    if (user.totpEnabled) {
      const code = parsed.data.code;
      if (!code) return reply.code(401).send({ error: "2fa_required" });
      try {
        const result = await verifyForLogin(app.master, user, code);
        if (!result.ok) return reply.code(401).send({ error: "invalid_2fa" });
        if (result.usedRecovery) {
          await app.audit(req, { action: "2fa.recovery_used", category: "auth", target: user.id, actor: user.id });
        }
      } catch (err) {
        if (err instanceof TwoFAConfigError) return reply.code(500).send({ error: "server_misconfigured" });
        throw err;
      }
    }

    // Fully authenticated (password AND any 2FA): clear the failure counter / lock
    // and stamp the last-login time.
    await recordSuccess(app.master, user.id);
    await markLoggedIn(app.master, user.id);

    // Issue the refresh token first so we can bind the access token to its row id
    // (the session) plus the user's current token version — enabling instant revoke.
    const { token: refreshToken, id: sid } = await issueRefreshToken(app.master, user.id, app.config.refreshTtlSec, {
      userAgent: req.headers["user-agent"] ?? null,
      ip: req.ip,
    });
    const accessToken = await reply.jwtSign({ sub: user.id, sid, tv: user.tokenVersion }, { expiresIn: app.config.accessTtl });
    await app.audit(req, { action: "auth.login", category: "auth", target: user.id, actor: user.id });
    return { accessToken, refreshToken, user: toPublicUser(user) };
  });

  app.post("/api/auth/refresh", async (req, reply) => {
    const parsed = refreshBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const rotated = await rotateRefreshToken(app.master, parsed.data.refreshToken, app.config.refreshTtlSec);
    if (!rotated) return reply.code(401).send({ error: "invalid_token" });

    // Bind the new access token to the rotated session id and the user's current
    // token version, so revocation checks keep working across refreshes.
    const tv = (await getTokenVersion(app.master, rotated.userId)) ?? 0;
    const accessToken = await reply.jwtSign(
      { sub: rotated.userId, sid: rotated.sessionId, tv },
      { expiresIn: app.config.accessTtl },
    );
    return { accessToken, refreshToken: rotated.refreshToken };
  });

  app.post("/api/auth/logout", async (req) => {
    const parsed = refreshBody.safeParse(req.body);
    if (parsed.success) {
      // Resolve the owner before revoking so the logout is attributable in the audit log.
      const userId = await userIdForRefreshToken(app.master, parsed.data.refreshToken);
      await revokeRefreshToken(app.master, parsed.data.refreshToken);
      if (userId) await app.audit(req, { action: "auth.logout", category: "auth", target: userId, actor: userId });
    }
    return { ok: true };
  });

  app.get("/api/me", { preHandler: [app.authenticate] }, async (req) => {
    const subject = req.subject!;
    if (subject.userId === STATIC_ADMIN_ID) {
      return { user: { id: STATIC_ADMIN_ID, username: "admin", isOwner: true }, permissions: [], attributes: [], isOwner: true };
    }
    const [user] = await app.master.select().from(users).where(eq(users.id, subject.userId)).limit(1);
    const required = await isRequired(app.master);
    return {
      user: user ? toPublicUser(user) : null,
      permissions: subject.permissions,
      attributes: subject.attributes,
      isOwner: subject.isOwner,
      // Surface the enrolment nag: required by policy but not yet enrolled.
      mustSetup2fa: required && !!user && !user.totpEnabled,
    };
  });

  // --- Self-service: the caller manages their own sessions, profile, password ---

  app.get("/api/me/sessions", { preHandler: [app.authenticate] }, async (req) => {
    // The access token carries `sid` (the active refresh-token row id), so we can
    // flag the caller's CURRENT session without needing the raw refresh token.
    const sid = req.user?.sid;
    const rows = await listSessions(app.master, req.subject!.userId);
    return { rows: rows.map((r) => ({ ...r, current: sid !== undefined && r.id === sid })) };
  });

  app.delete("/api/me/sessions/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.subject!.userId;
    // Only allow revoking a session that belongs to the caller (else 404).
    const own = (await listSessions(app.master, userId)).some((s) => s.id === id);
    if (!own) return reply.code(404).send({ error: "not_found" });
    await terminateSession(app.master, id);
    await app.audit(req, { action: "session.terminate", category: "auth", target: id, actor: userId });
    return { ok: true };
  });

  app.patch("/api/me/profile", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = profileBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const userId = req.subject!.userId;

    const update: Partial<typeof users.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (parsed.data.displayName !== undefined) update.displayName = parsed.data.displayName;
    if (parsed.data.email !== undefined) update.email = parsed.data.email;

    const [updated] = await app.master.update(users).set(update).where(eq(users.id, userId)).returning();
    if (!updated) return reply.code(404).send({ error: "not_found" });
    const user = toPublicUser(updated);
    await app.audit(req, { action: "profile.update", category: "auth", target: userId, actor: userId, after: user });
    return { user };
  });

  app.post("/api/me/password", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = passwordBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const userId = req.subject!.userId;

    const [user] = await app.master.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return reply.code(404).send({ error: "not_found" });
    if (!user.passwordHash) return reply.code(400).send({ error: "oidc_user" });
    if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
      return reply.code(400).send({ error: "invalid_current" });
    }

    await app.master
      .update(users)
      .set({ passwordHash: hashPassword(parsed.data.newPassword), updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId));

    // Security action → sign OTHER sessions out and invalidate every already-issued
    // access token (bump version), but keep the caller signed in: re-issue a fresh
    // access token for THIS session (its refresh row is left alive).
    const sid = req.user?.sid;
    await clearLock(app.master, userId); // a password change clears any active lockout
    await app.audit(req, { action: "password.change", category: "auth", target: userId, actor: userId });

    if (sid) {
      await terminateOtherSessions(app.master, userId, sid);
      await bumpTokenVersion(app.master, userId);
      const tv = (await getTokenVersion(app.master, userId)) ?? 0;
      const accessToken = await reply.jwtSign({ sub: userId, sid, tv }, { expiresIn: app.config.accessTtl });
      return { ok: true, accessToken };
    }
    // No session bound (e.g. static admin) → fall back to revoke-everywhere.
    await terminateAllForUser(app.master, userId);
    await bumpTokenVersion(app.master, userId);
    return { ok: true };
  });

  // --- Self-service: two-factor (TOTP) enrolment / removal ---

  app.get("/api/me/2fa", { preHandler: [app.authenticate] }, async (req) => {
    const userId = req.subject!.userId;
    const [user] = await app.master.select().from(users).where(eq(users.id, userId)).limit(1);
    const required = await isRequired(app.master);
    return { enabled: !!user?.totpEnabled, required };
  });

  app.post("/api/me/2fa/setup", { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.subject!.userId;
    const [user] = await app.master.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return reply.code(404).send({ error: "not_found" });
    try {
      return await beginSetup(app.master, userId, user.username);
    } catch (err) {
      if (err instanceof TwoFAConfigError) return reply.code(500).send({ error: "server_misconfigured" });
      throw err;
    }
  });

  app.post("/api/me/2fa/enable", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = codeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const userId = req.subject!.userId;
    try {
      const recoveryCodes = await enable(app.master, userId, parsed.data.code);
      await app.audit(req, { action: "2fa.enable", category: "auth", target: userId, actor: userId });
      return { recoveryCodes };
    } catch (err) {
      if (err instanceof TwoFAConfigError) return reply.code(500).send({ error: "server_misconfigured" });
      if (err instanceof TwoFAVerifyError) return reply.code(400).send({ error: "invalid_2fa" });
      throw err;
    }
  });

  app.post("/api/me/2fa/disable", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = codeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const userId = req.subject!.userId;
    const [user] = await app.master.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !user.totpEnabled) return reply.code(404).send({ error: "not_found" });
    try {
      // Require proof of possession (current TOTP or a recovery code) before removal.
      const result = await verifyForLogin(app.master, user, parsed.data.code);
      if (!result.ok) return reply.code(400).send({ error: "invalid_2fa" });
      await disable(app.master, userId);
      await app.audit(req, { action: "2fa.disable", category: "auth", target: userId, actor: userId });
      return { ok: true };
    } catch (err) {
      if (err instanceof TwoFAConfigError) return reply.code(500).send({ error: "server_misconfigured" });
      throw err;
    }
  });
}

const STATIC_ADMIN_ID = "static-admin";
