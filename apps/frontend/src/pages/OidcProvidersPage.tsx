/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * SSO / OIDC admin: configure MULTIPLE identity providers (Google, Microsoft,
 * Authentik, Auth0, Clerk, Okta, Keycloak, …) entirely from the UI, each enabled
 * independently and shown as its own button on the login page. Client secrets are
 * write-only. Each provider shows the exact callback URI to register at its IdP.
 */
import { useState, type FormEvent } from "react";
import { Check, Copy } from "lucide-react";
import { OIDC_BRANDS, OIDC_TEMPLATES, type OidcBrand } from "@argus/shared";
import { useOidc } from "@/hooks/useOidc";
import { useAuth } from "@/auth/AuthContext";
import { useConfirm } from "@/components/ConfirmProvider";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { PromptDialog } from "@/components/PromptDialog";

const inputCls =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";

export function OidcProvidersPage() {
  const { has } = useAuth();
  const confirm = useConfirm();
  const { loading, error, providers, create, update, remove } = useOidc();
  const canWrite = has("settings:write");

  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [brand, setBrand] = useState<OidcBrand>("generic");
  const [enabled, setEnabled] = useState(true);
  const [templateHint, setTemplateHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [secretFor, setSecretFor] = useState<string | null>(null);

  function applyTemplate(key: string) {
    const t = OIDC_TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    setBrand(t.brand);
    setName(t.name === "Generic OIDC" ? "" : t.name);
    setIssuer(t.issuer);
    setTemplateHint(t.hint);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !issuer.trim() || !clientId.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      await create({ name: name.trim(), issuer: issuer.trim(), clientId: clientId.trim(), clientSecret: clientSecret || undefined, brand, enabled });
      setName(""); setIssuer(""); setClientId(""); setClientSecret(""); setBrand("generic"); setEnabled(true); setTemplateHint(null);
    } catch {
      setFormError("Failed to create provider. Check the issuer URL (must support OIDC discovery).");
    } finally {
      setBusy(false);
    }
  }

  async function copyRedirect(id: string, uri: string) {
    try {
      await navigator.clipboard.writeText(uri);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { /* clipboard blocked — operator can select manually */ }
  }

  if (loading) return <Spinner label="Loading SSO settings…" />;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Authentication (SSO)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Add one or more OIDC providers. Each <span className="text-slate-300">enabled</span> provider shows as a button on the login page.
          Register each provider's <span className="text-slate-300">callback URL</span> (below) at its IdP.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      ) : null}

      {/* Providers */}
      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Brand</th>
              <th className="px-4 py-3 font-medium">Issuer</th>
              <th className="px-4 py-3 font-medium">Secret</th>
              <th className="px-4 py-3 font-medium">Callback to register</th>
              <th className="px-4 py-3 font-medium">State</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {providers.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-slate-500">No SSO providers configured.</td></tr>
            ) : (
              providers.map((p) => (
                <tr key={p.id} className="text-slate-200">
                  <td className="px-4 py-3">{p.name}</td>
                  <td className="px-4 py-3 text-slate-400">{p.brand}</td>
                  <td className="px-4 py-3 text-slate-400">{p.issuer}</td>
                  <td className="px-4 py-3 text-slate-400">{p.hasSecret ? "set" : "—"}</td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => copyRedirect(p.id, p.redirectUri)} title={p.redirectUri}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500">
                      {copiedId === p.id ? <Check size={12} /> : <Copy size={12} />} {copiedId === p.id ? "Copied" : "Copy URL"}
                    </button>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={p.enabled ? "approved" : "revoked"} /></td>
                  <td className="px-4 py-3">
                    {canWrite ? (
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => void update(p.id, { enabled: !p.enabled })}
                          className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500">
                          {p.enabled ? "Disable" : "Enable"}
                        </button>
                        <button type="button" onClick={() => setSecretFor(p.id)}
                          className="rounded-md border border-sky-600/50 px-2.5 py-1 text-xs text-sky-300 hover:bg-sky-500/10">
                          Set secret
                        </button>
                        <button type="button"
                          onClick={() => void (async () => {
                            if (await confirm({ title: "Delete provider", message: `Delete SSO provider "${p.name}"?`, confirmLabel: "Delete" }))
                              await remove(p.id);
                          })()}
                          className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/10">
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* Add provider */}
      {canWrite ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">Add provider</h2>
          <form onSubmit={onCreate} className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Start from a template</span>
                <select defaultValue="" onChange={(e) => applyTemplate(e.target.value)} className={inputCls}>
                  <option value="">— choose a provider —</option>
                  {OIDC_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Brand (login button)</span>
                <select value={brand} onChange={(e) => setBrand(e.target.value as OidcBrand)} className={inputCls}>
                  {OIDC_BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Google Workspace" className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Issuer URL</span>
                <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="https://accounts.google.com" className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Client ID</span>
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Client secret</span>
                <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="stored encrypted" className={inputCls} />
              </label>
            </div>
            {templateHint ? <p className="text-xs text-sky-300/80">{templateHint}</p> : null}
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Enable now (show on the login page)
            </label>
            {formError ? <div className="text-sm text-rose-300">{formError}</div> : null}
            <button type="submit" disabled={busy || !name.trim() || !issuer.trim() || !clientId.trim()}
              className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-60">
              {busy ? "Saving…" : "Add provider"}
            </button>
          </form>
        </section>
      ) : null}

      {secretFor ? (
        <PromptDialog
          title="Set client secret"
          label="New client secret"
          confirmLabel="Save"
          onCancel={() => setSecretFor(null)}
          onSubmit={async (value) => {
            await update(secretFor, { clientSecret: value });
            setSecretFor(null);
          }}
        />
      ) : null}
    </div>
  );
}
