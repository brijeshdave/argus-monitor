/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Login page: centered credential card. Redirects to "/" once authed.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Tv } from "lucide-react";
import type { PublicOidcProvider } from "@argus/shared";
import { BRAND } from "@/lib/brand";
import { useAuth } from "@/auth/AuthContext";
import { ApiError } from "@/lib/api";

/** Accent classes per known brand for the SSO buttons (generic = neutral). */
const BRAND_ACCENT: Record<string, string> = {
  google: "border-slate-600 hover:border-slate-400",
  microsoft: "border-sky-700/60 hover:border-sky-500",
  authentik: "border-orange-700/60 hover:border-orange-500",
  auth0: "border-orange-700/60 hover:border-orange-500",
  clerk: "border-violet-700/60 hover:border-violet-500",
  okta: "border-blue-700/60 hover:border-blue-500",
  keycloak: "border-red-700/60 hover:border-red-500",
  generic: "border-slate-700 hover:border-slate-500",
};

export function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // "credentials" = username/password step; "twofa" = second-factor step.
  const [step, setStep] = useState<"credentials" | "twofa">("credentials");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ssoProviders, setSsoProviders] = useState<PublicOidcProvider[]>([]);

  // Already signed in (e.g. navigated here directly) → bounce to dashboard.
  useEffect(() => {
    if (status === "authed") navigate("/", { replace: true });
  }, [status, navigate]);

  // Enabled SSO providers (public, unauthenticated) → rendered as buttons.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/oidc/providers")
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((d: { providers?: PublicOidcProvider[] }) => { if (!cancelled) setSsoProviders(d.providers ?? []); })
      .catch(() => { /* SSO is optional */ });
    return () => { cancelled = true; };
  }, []);

  function errorCode(err: unknown): string | undefined {
    return err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password, step === "twofa" ? code.trim() : undefined);
      navigate("/", { replace: true });
    } catch (err) {
      const ec = errorCode(err);
      if (ec === "2fa_required") {
        // Password accepted — advance to the second-factor step.
        setStep("twofa");
        setError(null);
      } else if (ec === "invalid_2fa") {
        setError("Invalid authentication code. Try again or use a recovery code.");
      } else if (err instanceof ApiError && err.status === 401) {
        setError("Invalid username or password.");
        setStep("credentials");
      } else {
        setError("Unable to sign in. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-950 px-4 text-slate-100">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-wide">{BRAND.name}</h1>
          <p className="mt-1 text-sm text-slate-400">{BRAND.tagline} platform</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {step === "credentials" ? (
            <>
              <div>
                <label htmlFor="username" className="mb-1 block text-sm text-slate-400">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-1 block text-sm text-slate-400">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
                />
              </div>
            </>
          ) : (
            <div>
              <label htmlFor="code" className="mb-1 block text-sm text-slate-400">
                Authentication code
              </label>
              <input
                id="code"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                placeholder="6-digit code or recovery code"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm tracking-widest text-slate-100 outline-none focus:border-sky-500"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Enter the code from your authenticator app, or one of your recovery codes.
              </p>
            </div>
          )}

          {error ? (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Signing in…" : step === "twofa" ? "Verify" : "Sign in"}
          </button>

          {step === "twofa" ? (
            <button
              type="button"
              onClick={() => {
                setStep("credentials");
                setCode("");
                setError(null);
              }}
              className="w-full text-center text-xs text-slate-400 transition-colors hover:text-slate-200"
            >
              Back to sign in
            </button>
          ) : null}
        </form>

        {step === "credentials" && ssoProviders.length > 0 ? (
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-600">
              <span className="h-px flex-1 bg-slate-800" /> or continue with <span className="h-px flex-1 bg-slate-800" />
            </div>
            <div className="space-y-2">
              {ssoProviders.map((p) => (
                <a
                  key={p.id}
                  href={p.loginUrl}
                  className={`block w-full rounded-md border px-3 py-2 text-center text-sm text-slate-200 transition-colors ${BRAND_ACCENT[p.brand] ?? BRAND_ACCENT.generic}`}
                >
                  Continue with {p.name}
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {/* Wallboard entry — an unattended screen lands on /login by default, so give
            it a way to reach the board / pairing code without an operator sign-in.
            Same tab: a TV should stay on the wall once it gets there. */}
        <a
          href="/wall"
          className="mt-6 flex items-center justify-center gap-2 rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-sky-500/50 hover:text-sky-200"
        >
          <Tv size={15} /> Open wallboard display
        </a>

        {/* Public links — documentation + status, opened in a new tab. */}
        <div className="mt-4 flex items-center justify-center gap-4 border-t border-slate-800 pt-4 text-xs text-slate-500">
          <a href="/docs" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-slate-300">Documentation</a>
          <span className="h-3 w-px bg-slate-800" />
          <a href="/status" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-slate-300">Status</a>
        </div>
      </div>
    </div>
  );
}
