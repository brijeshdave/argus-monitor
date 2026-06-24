/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Self-service profile page: every authenticated user can view their identity,
 * edit display name + email, change their password, and review/sign-out their
 * active sessions. No permission gate — this is "my account". Data fetching lives
 * in useProfile; this component stays presentational.
 */
import { useState, type FormEvent } from "react";
import type { SessionDTO, TwoFASetupResponse } from "@argus/shared";
import { useAuth } from "@/auth/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { useTwoFA } from "@/hooks/useTwoFA";
import { Spinner } from "@/components/Spinner";
import { ApiError } from "@/lib/api";

const inputCls =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";
const primaryBtn =
  "rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60";
const rowBtn =
  "rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40";

/** Best-effort browser + OS extraction from a user-agent string (no library). */
function prettifyUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Windows NT 10/.test(ua)
    ? "Windows"
    : /Windows/.test(ua)
      ? "Windows"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Android/.test(ua)
          ? "Android"
          : /iPhone|iPad|iOS/.test(ua)
            ? "iOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "Unknown OS";
  return `${browser} on ${os}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function ProfilePage() {
  const { user, mustSetup2fa } = useAuth();
  const { loading, error, sessions, reload, updateProfile, changePassword, revokeSession } = useProfile();

  if (loading) return <Spinner label="Loading profile…" />;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-slate-100">Profile</h1>

      {mustSetup2fa ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Two-factor authentication is required by your administrator. Please enable it below to keep your access.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileCard
          username={user?.username ?? "—"}
          displayName={user?.displayName ?? ""}
          email={user?.email ?? ""}
          onSave={updateProfile}
        />
        <PasswordCard onChange={changePassword} />
      </div>

      <TwoFactorCard />

      <SessionsCard
        sessions={sessions}
        error={error}
        onRevoke={revokeSession}
        onReload={reload}
      />
    </div>
  );
}

function TwoFactorCard() {
  const { loading, status, setup, enable, disable } = useTwoFA();
  // UI phases: "idle" (status view), "enrolling" (secret shown, awaiting code),
  // "codes" (recovery codes shown once), "disabling" (code prompt to remove).
  const [phase, setPhase] = useState<"idle" | "enrolling" | "codes" | "disabling">("idle");
  const [pending, setPending] = useState<TwoFASetupResponse | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function reset() {
    setPhase("idle");
    setPending(null);
    setCode("");
    setRecovery([]);
    setMsg(null);
  }

  async function startSetup() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await setup();
      setPending(res);
      setPhase("enrolling");
    } catch {
      setMsg({ ok: false, text: "Could not start 2FA setup. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const codes = await enable(code.trim());
      setRecovery(codes);
      setPhase("codes");
      setCode("");
    } catch (err) {
      const errCode = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
      setMsg({
        ok: false,
        text: errCode === "invalid_2fa" ? "That code is incorrect. Check your app and try again." : "Could not enable 2FA.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await disable(code.trim());
      reset();
      setMsg({ ok: true, text: "Two-factor authentication disabled." });
    } catch (err) {
      const errCode = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
      setMsg({
        ok: false,
        text: errCode === "invalid_2fa" ? "That code is incorrect." : "Could not disable 2FA.",
      });
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    void navigator.clipboard?.writeText(text);
  }

  function downloadCodes() {
    const blob = new Blob([recovery.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "argus-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="mb-4 text-base font-semibold text-slate-100">Two-factor authentication</h2>

      {loading ? (
        <Spinner label="Loading…" />
      ) : phase === "codes" ? (
        <div className="space-y-3">
          <p className="text-sm text-emerald-300">
            Two-factor authentication is enabled. Save these recovery codes now — they will not be shown again.
          </p>
          <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-800 bg-slate-950 p-3 font-mono text-sm text-slate-200">
            {recovery.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={downloadCodes} className={rowBtn}>Download</button>
            <button type="button" onClick={() => copy(recovery.join("\n"))} className={rowBtn}>Copy</button>
            <button type="button" onClick={reset} className={primaryBtn}>Done</button>
          </div>
        </div>
      ) : phase === "enrolling" && pending ? (
        <form onSubmit={confirmEnable} className="space-y-4">
          <p className="text-sm text-slate-400">
            Add this account to an authenticator app (Google Authenticator, 1Password, Authy…), then enter the
            6-digit code it generates to finish.
          </p>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Secret key</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200">
                {pending.secret}
              </code>
              <button type="button" onClick={() => copy(pending.secret)} className={rowBtn}>Copy</button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Provisioning URI</label>
            <div className="flex items-center gap-2">
              <a
                href={pending.otpauthUri}
                className="flex-1 break-all rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-sky-300 hover:text-sky-200"
              >
                {pending.otpauthUri}
              </a>
              <button type="button" onClick={() => copy(pending.otpauthUri)} className={rowBtn}>Copy</button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Verification code</label>
            <input
              className={`${inputCls} tracking-widest`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              autoComplete="one-time-code"
              autoFocus
            />
          </div>
          {msg ? <p className={`text-sm ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={reset} className={rowBtn}>Cancel</button>
            <button type="submit" disabled={busy || code.trim().length < 6} className={primaryBtn}>
              {busy ? "Verifying…" : "Enable"}
            </button>
          </div>
        </form>
      ) : phase === "disabling" ? (
        <form onSubmit={confirmDisable} className="space-y-4">
          <p className="text-sm text-slate-400">
            Enter a current authentication code (or a recovery code) to turn off two-factor authentication.
          </p>
          <input
            className={`${inputCls} tracking-widest`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code"
            autoComplete="one-time-code"
            autoFocus
          />
          {msg ? <p className={`text-sm ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={reset} className={rowBtn}>Cancel</button>
            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="rounded-md border border-rose-600/50 px-3 py-2 text-sm text-rose-300 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Disabling…" : "Disable 2FA"}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            {status?.enabled
              ? "Two-factor authentication is enabled on your account."
              : "Add an extra layer of security by requiring a one-time code at sign-in."}
            {status?.required && !status.enabled ? " It is required by your administrator." : null}
          </p>
          {msg ? <p className={`text-sm ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</p> : null}
          <div className="flex justify-end">
            {status?.enabled ? (
              <button type="button" onClick={() => { setMsg(null); setPhase("disabling"); }} className={rowBtn}>
                Disable
              </button>
            ) : (
              <button type="button" onClick={() => void startSetup()} disabled={busy} className={primaryBtn}>
                {busy ? "Starting…" : "Enable two-factor"}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ProfileCard({
  username,
  displayName,
  email,
  onSave,
}: {
  username: string;
  displayName: string;
  email: string;
  onSave: (patch: { displayName?: string; email?: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState(displayName);
  const [mail, setMail] = useState(email);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await onSave({ displayName: name.trim(), email: mail.trim() || null });
      setMsg({ ok: true, text: "Profile updated." });
    } catch {
      setMsg({ ok: false, text: "Update failed. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="mb-4 text-base font-semibold text-slate-100">Account</h2>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Username</label>
          <input className={`${inputCls} opacity-60`} value={username} disabled readOnly />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Display name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Email</label>
          <input type="email" className={inputCls} value={mail} onChange={(e) => setMail(e.target.value)} />
        </div>
        {msg ? (
          <p className={`text-sm ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</p>
        ) : null}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </section>
  );
}

function PasswordCard({
  onChange,
}: {
  onChange: (currentPassword: string, newPassword: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) {
      setMsg({ ok: false, text: "New password must be at least 8 characters." });
      return;
    }
    if (next !== confirm) {
      setMsg({ ok: false, text: "New passwords do not match." });
      return;
    }
    setBusy(true);
    try {
      await onChange(current, next);
      setMsg({ ok: true, text: "Password changed. Other sessions were signed out." });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      const code = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
      const text =
        code === "invalid_current"
          ? "Current password is incorrect."
          : code === "oidc_user"
            ? "Password is managed by your identity provider."
            : "Password change failed. Please try again.";
      setMsg({ ok: false, text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="mb-4 text-base font-semibold text-slate-100">Change password</h2>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Current password</label>
          <input type="password" className={inputCls} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">New password</label>
          <input type="password" className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Confirm new password</label>
          <input type="password" className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {msg ? (
          <p className={`text-sm ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</p>
        ) : null}
        <div className="flex justify-end">
          <button type="submit" disabled={busy || !current || !next} className={primaryBtn}>
            {busy ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </section>
  );
}

function SessionsCard({
  sessions,
  error,
  onRevoke,
  onReload,
}: {
  sessions: SessionDTO[];
  error: string | null;
  onRevoke: (id: string) => Promise<void>;
  onReload: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function revoke(id: string) {
    setBusyId(id);
    try {
      await onRevoke(id);
    } catch {
      onReload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
        <h2 className="text-base font-semibold text-slate-100">Active sessions</h2>
      </div>
      {error ? (
        <div className="px-5 py-3 text-sm text-rose-300">{error}</div>
      ) : null}
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Device</th>
            <th className="px-4 py-3 font-medium">IP</th>
            <th className="px-4 py-3 font-medium">Signed in</th>
            <th className="px-4 py-3 font-medium">Last used</th>
            <th className="px-4 py-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {sessions.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-slate-500">
                No active sessions.
              </td>
            </tr>
          ) : (
            sessions.map((s) => (
              <tr key={s.id} className="text-slate-200">
                <td className="px-4 py-3">
                  {prettifyUserAgent(s.userAgent)}
                  {s.current ? (
                    <span className="ml-2 inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300 ring-1 ring-emerald-500/30">
                      current
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-slate-400">{s.ip ?? "—"}</td>
                <td className="px-4 py-3 text-slate-400">{fmtTime(s.createdAt)}</td>
                <td className="px-4 py-3 text-slate-400">{fmtTime(s.lastUsedAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={busyId === s.id}
                      onClick={() => void revoke(s.id)}
                      className={rowBtn}
                    >
                      {busyId === s.id ? "Signing out…" : "Sign out"}
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
