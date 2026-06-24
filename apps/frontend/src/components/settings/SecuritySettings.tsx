/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Security settings tab: mandate two-factor auth platform-wide, and tune the
 * per-account login lockout policy (consecutive-failure threshold + cooldown).
 * Backed by the settings store keys `security.require2fa` and `security.lockout`.
 */
import { useEffect, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useAuth } from "@/auth/AuthContext";
import { Spinner } from "@/components/Spinner";

const inputCls =
  "w-28 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 disabled:opacity-60";

const REQUIRE_2FA_KEY = "security.require2fa";
const LOCKOUT_KEY = "security.lockout";
const DEFAULT_LOCKOUT = { maxAttempts: 5, windowMinutes: 15 };

export function SecuritySettings() {
  const { has } = useAuth();
  const canWrite = has("settings:write");
  const { loading, error, settings, save } = useSettings();

  const [require2fa, setRequire2fa] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState(DEFAULT_LOCKOUT.maxAttempts);
  const [windowMinutes, setWindowMinutes] = useState(DEFAULT_LOCKOUT.windowMinutes);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setRequire2fa(settings[REQUIRE_2FA_KEY] === true);
    const lk = settings[LOCKOUT_KEY];
    if (lk && typeof lk === "object") {
      const o = lk as Record<string, unknown>;
      if (typeof o.maxAttempts === "number") setMaxAttempts(o.maxAttempts);
      if (typeof o.windowMinutes === "number") setWindowMinutes(o.windowMinutes);
    }
  }, [settings]);

  async function flash(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(`Saved ${label}`);
    } catch {
      setMsg("Save failed");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 2500);
    }
  }

  const toggle2fa = (next: boolean) => {
    setRequire2fa(next);
    void flash("two-factor policy", () => save(REQUIRE_2FA_KEY, next));
  };

  const saveLockout = () =>
    flash("lockout policy", () => save(LOCKOUT_KEY, { maxAttempts: Math.max(1, maxAttempts), windowMinutes: Math.max(1, windowMinutes) }));

  if (loading) return <Spinner label="Loading security settings…" />;

  return (
    <div className="space-y-5">
      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}
      {msg ? <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">{msg}</div> : null}

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Two-factor authentication</h3>
        <label className="mt-3 flex items-start gap-3 text-sm text-slate-200">
          <input type="checkbox" className="mt-0.5" checked={require2fa} disabled={!canWrite || busy} onChange={(e) => toggle2fa(e.target.checked)} />
          <span>
            Require all users to set up TOTP two-factor authentication.
            <span className="mt-0.5 block text-xs text-slate-500">When on, users without 2FA are prompted to enrol at next login.</span>
          </span>
        </label>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Login lockout</h3>
        <p className="mt-1 text-xs text-slate-500">Lock an account after too many consecutive failed local logins. A successful login clears the counter.</p>
        <div className="mt-3 flex flex-wrap items-end gap-5">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Max failed attempts</span>
            <input type="number" min={1} value={maxAttempts} disabled={!canWrite} onChange={(e) => setMaxAttempts(Math.max(1, Number(e.target.value)))} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Lockout duration (min)</span>
            <input type="number" min={1} value={windowMinutes} disabled={!canWrite} onChange={(e) => setWindowMinutes(Math.max(1, Number(e.target.value)))} className={inputCls} />
          </label>
          {canWrite ? (
            <button type="button" onClick={() => void saveLockout()} disabled={busy} className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-60">
              {busy ? "Saving…" : "Save"}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
