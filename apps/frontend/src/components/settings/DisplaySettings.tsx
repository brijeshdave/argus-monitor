/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Displays settings tab: the global session lifetime for paired wallboard displays
 * (a sliding window from a device's last check-in before it must re-pair). Applies
 * to all devices. Backed by the settings key `deviceSessionTtlSec`.
 */
import { useEffect, useState } from "react";
import { DEVICE_SESSION_TTL_DEFAULT, DEVICE_SESSION_TTL_KEY, DEVICE_SESSION_TTLS } from "@argus/shared";
import { useSettings } from "@/hooks/useSettings";
import { useAuth } from "@/auth/AuthContext";
import { Spinner } from "@/components/Spinner";

export function DisplaySettings() {
  const { has } = useAuth();
  const canWrite = has("settings:write");
  const { loading, error, settings, save } = useSettings();

  const [ttl, setTtl] = useState<number>(DEVICE_SESSION_TTL_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const v = settings[DEVICE_SESSION_TTL_KEY];
    if (typeof v === "number") setTtl(v);
  }, [settings]);

  const onChange = (sec: number) => {
    setTtl(sec);
    setBusy(true);
    setMsg(null);
    save(DEVICE_SESSION_TTL_KEY, sec)
      .then(() => setMsg("Saved display session lifetime"))
      .catch(() => setMsg("Save failed"))
      .finally(() => {
        setBusy(false);
        setTimeout(() => setMsg(null), 2500);
      });
  };

  if (loading) return <Spinner label="Loading display settings…" />;

  return (
    <div className="space-y-5">
      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}
      {msg ? <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">{msg}</div> : null}

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Display session lifetime</h3>
        <p className="mt-1 text-xs text-slate-500">
          How long a paired wallboard display stays connected before it must re-pair, measured from its last check-in. Applies to all displays.
        </p>
        <label className="mt-3 block max-w-xs">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Lifetime</span>
          <select
            value={ttl}
            disabled={!canWrite || busy}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 disabled:opacity-60"
          >
            {DEVICE_SESSION_TTLS.map((o) => (
              <option key={o.sec} value={o.sec}>{o.label}</option>
            ))}
          </select>
        </label>
      </section>
    </div>
  );
}
