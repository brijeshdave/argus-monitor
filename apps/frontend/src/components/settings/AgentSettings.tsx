/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Agents settings tab: the global default collect/push interval for agents that
 * don't have a per-agent override. Saving writes the `agent.pushIntervalSec`
 * setting and re-pushes the effective cadence to every connected agent over the
 * control channel (applied live — no restart). Per-agent overrides live on each
 * agent's detail page.
 */
import { useEffect, useState } from "react";
import { AGENT_INGEST_HOSTS_KEY, AGENT_PUSH_INTERVAL_DEFAULT, AGENT_PUSH_INTERVAL_KEY, AGENT_PUSH_INTERVALS, AGENT_TIMEZONE_KEY } from "@argus/shared";
import { useSettings } from "@/hooks/useSettings";
import { useAuth } from "@/auth/AuthContext";
import { api } from "@/lib/api";
import { Spinner } from "@/components/Spinner";

export function AgentSettings() {
  const { has } = useAuth();
  const canWrite = has("settings:write");
  const { loading, error, settings, save } = useSettings();

  const [sec, setSec] = useState<number>(AGENT_PUSH_INTERVAL_DEFAULT);
  const [tz, setTz] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Additional ingest hosts: extra backends agents ALSO push telemetry to.
  const [hosts, setHosts] = useState<string[]>([]);
  const [newHost, setNewHost] = useState("");

  useEffect(() => {
    const v = settings[AGENT_PUSH_INTERVAL_KEY];
    if (typeof v === "number") setSec(v);
    const t = settings[AGENT_TIMEZONE_KEY];
    if (typeof t === "string") setTz(t);
    const h = settings[AGENT_INGEST_HOSTS_KEY];
    if (Array.isArray(h)) setHosts(h.filter((x): x is string => typeof x === "string"));
  }, [settings]);

  const saveHosts = (next: string[]) => {
    setHosts(next);
    setBusy(true);
    setMsg(null);
    save(AGENT_INGEST_HOSTS_KEY, next)
      .then(() => setMsg("Saved — agents pick it up on their next config refresh"))
      .catch(() => setMsg("Save failed"))
      .finally(() => {
        setBusy(false);
        setTimeout(() => setMsg(null), 3000);
      });
  };

  const addHost = () => {
    const url = newHost.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/.+/i.test(url) || hosts.includes(url)) return;
    saveHosts([...hosts, url]);
    setNewHost("");
  };

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const saveTz = () => {
    setBusy(true);
    setMsg(null);
    save(AGENT_TIMEZONE_KEY, tz.trim())
      .then(() => setMsg("Saved — agents adopt it on their next config refresh"))
      .catch(() => setMsg("Save failed"))
      .finally(() => {
        setBusy(false);
        setTimeout(() => setMsg(null), 3000);
      });
  };

  const onChange = (next: number) => {
    setSec(next);
    setBusy(true);
    setMsg(null);
    save(AGENT_PUSH_INTERVAL_KEY, next)
      .then(() => api.post<{ pushed: number }>("/api/agents/sync-config", {}))
      .then((r) => setMsg(`Saved — applied to ${r.pushed} agent${r.pushed === 1 ? "" : "s"} live`))
      .catch(() => setMsg("Save failed"))
      .finally(() => {
        setBusy(false);
        setTimeout(() => setMsg(null), 3000);
      });
  };

  if (loading) return <Spinner label="Loading agent settings…" />;

  return (
    <div className="space-y-5">
      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}
      {msg ? <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">{msg}</div> : null}

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Default push frequency</h3>
        <p className="mt-1 text-xs text-slate-500">
          How often agents collect and push telemetry. Applies to every agent without its own override (set per agent on its
          detail page). Changes are sent to running agents immediately over the control channel — no restart.
        </p>
        <label className="mt-3 block max-w-xs">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Interval</span>
          <select
            value={sec}
            disabled={!canWrite || busy}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 disabled:opacity-60"
          >
            {AGENT_PUSH_INTERVALS.map((o) => (
              <option key={o.sec} value={o.sec}>{o.label}</option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs text-slate-500">Shorter intervals = fresher data but more telemetry volume &amp; load. 30s suits most fleets.</p>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Agent log timezone</h3>
        <p className="mt-1 text-xs text-slate-500">
          Timezone agents use to stamp their logs (the <span className="text-slate-300">logs</span> command + live log lines).
          Blank = the server's timezone. An IANA name like <span className="font-mono">Asia/Kolkata</span>. A host can still
          override this locally in its <span className="font-mono">agent.json</span>.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Timezone (IANA)</span>
            <input
              type="text"
              value={tz}
              disabled={!canWrite || busy}
              onChange={(e) => setTz(e.target.value)}
              placeholder="blank = server default"
              list="agent-tz-list"
              className="w-64 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 disabled:opacity-60"
            />
            <datalist id="agent-tz-list">
              <option value="UTC" />
              <option value={browserTz} />
              <option value="America/New_York" />
              <option value="Europe/London" />
              <option value="Asia/Kolkata" />
              <option value="Asia/Singapore" />
            </datalist>
          </label>
          {canWrite ? (
            <button type="button" onClick={saveTz} disabled={busy} className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-60">
              {busy ? "Saving…" : "Save"}
            </button>
          ) : null}
          <button type="button" onClick={() => setTz(browserTz)} className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-slate-500" title="Use this browser's timezone">
            Use {browserTz}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Additional ingest hosts</h3>
        <p className="mt-1 text-xs text-slate-500">
          Extra backends every agent should ALSO push its telemetry to, beyond this master (e.g. a
          <span className="text-slate-300"> development</span> instance). The master stays in control; this list is delivered to
          agents with their config. Each agent uses its existing connection key for every target, so a target only accepts the
          data if it knows that key — e.g. a dev database <span className="text-slate-300">cloned from production</span>.
        </p>
        <div className="mt-3 space-y-2">
          {hosts.length === 0 ? <p className="text-xs text-slate-600">No additional hosts — agents push to this master only.</p> : null}
          {hosts.map((h) => (
            <div key={h} className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-slate-950 px-3 py-1.5 text-xs text-slate-200">{h}</code>
              {canWrite ? (
                <button type="button" onClick={() => saveHosts(hosts.filter((x) => x !== h))} disabled={busy} className="rounded-md border border-rose-600/50 px-2.5 py-1 text-xs text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-60">Remove</button>
              ) : null}
            </div>
          ))}
        </div>
        {canWrite ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Base URL</span>
              <input
                type="text"
                value={newHost}
                disabled={busy}
                onChange={(e) => setNewHost(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addHost(); } }}
                placeholder="https://argus-dev.example.com"
                className="w-80 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 disabled:opacity-60"
              />
            </label>
            <button type="button" onClick={addHost} disabled={busy || !/^https?:\/\/.+/i.test(newHost.trim())} className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">Add host</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
