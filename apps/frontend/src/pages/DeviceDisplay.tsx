/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Device display — the unattended-TV view shown at /wall when nobody is logged in. The
 * operator adds a display in the web UI (which shows a 6-digit code); the screen enters
 * that code here to pair. A persistent client fingerprint lets a revoked/reconnected
 * screen be recognised as the same device. Once paired it renders its assigned board,
 * re-resolving on a poll so server-side reassignment applies with nothing to touch.
 */
import { useEffect, useRef, useState } from "react";
import type { WallLayoutDTO } from "@argus/shared";
import { api, setOnSessionExpired } from "@/lib/api";
import { clear, setTokens } from "@/lib/tokens";
import { WallboardKiosk } from "@/pages/WallboardKiosk";

const K_ID = "argus.device.id";
const K_TOKEN = "argus.device.token";
const K_FP = "argus.device.fp"; // persistent client fingerprint (survives unpair)

/** Stable per-screen id so a reconnected display is tracked as the same device. */
function fingerprint(): string {
  let fp = localStorage.getItem(K_FP);
  if (!fp) { fp = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`); localStorage.setItem(K_FP, fp); }
  return fp;
}

type Phase = "code" | "ready";
interface Bundle { name: string; layout: WallLayoutDTO | null }

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-6 text-center text-slate-100">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-slate-800 bg-slate-900/60 p-8">{children}</div>
    </div>
  );
}

export function DeviceDisplay() {
  const [phase, setPhase] = useState<Phase>(() => (localStorage.getItem(K_TOKEN) ? "ready" : "code"));
  const [code, setCode] = useState("");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function unpair() {
    localStorage.removeItem(K_ID);
    localStorage.removeItem(K_TOKEN); // keep the fingerprint so we reconnect as the same device
    clear();
    setBundle(null); setCode("");
    setPhase("code");
  }

  /** Silently re-issue a token for this screen (by fingerprint) so a closed/reopened or
   *  token-dropped display reconnects without re-entering a code. Returns success. */
  async function tryReconnect(): Promise<boolean> {
    try {
      const res = await api.post<{ deviceId: string; token: string }>("/api/devices/reconnect", { fingerprint: fingerprint() });
      localStorage.setItem(K_ID, res.deviceId);
      localStorage.setItem(K_TOKEN, res.token);
      setTokens(res.token, res.token);
      setPhase("ready");
      return true;
    } catch { return false; }
  }

  // No stored token but this screen may already be a known device → try to reconnect
  // silently before falling back to the pairing-code screen.
  useEffect(() => {
    if (localStorage.getItem(K_TOKEN)) return;
    void tryReconnect();
  }, []);

  async function pair() {
    const c = code.trim();
    if (!/^\d{6}$/.test(c)) { setErr("Enter the 6-digit code shown in the web UI."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await api.post<{ deviceId: string; token: string }>("/api/devices/claim", { code: c, fingerprint: fingerprint() });
      localStorage.setItem(K_ID, res.deviceId);
      localStorage.setItem(K_TOKEN, res.token);
      setPhase("ready");
    } catch {
      setErr("That code didn't match. Check the code in the web UI and try again.");
    } finally { setBusy(false); }
  }

  // Once paired, use the device token as the access credential + resolve the board.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (phase !== "ready") return;
    const token = localStorage.getItem(K_TOKEN);
    if (!token) { setPhase("code"); return; }
    setTokens(token, token); // existing api client + live WS now authenticate as this device
    // Token rejected (expired/replaced) → try a silent fingerprint reconnect; only fall
    // back to the pairing screen if that fails (revoked or beyond the session lifetime).
    setOnSessionExpired(() => { void tryReconnect().then((ok) => { if (!ok) unpair(); }); });

    let stop = false;
    const load = async () => {
      try {
        const res = await api.get<Bundle>("/api/wall/bundle");
        if (!stop) setBundle(res);
      } catch { /* keep last board on transient errors */ }
    };
    void load();
    pollRef.current = setInterval(() => void load(), 20_000);
    return () => { stop = true; if (pollRef.current) clearInterval(pollRef.current); };
  }, [phase]);

  if (phase === "code") {
    return (
      <Center>
        <h1 className="text-xl font-semibold">Pair this display</h1>
        <p className="text-sm text-slate-400">In <span className="text-slate-200">Admin → Display devices</span>, click <span className="text-slate-200">Add display</span> and enter the 6-digit code shown there.</p>
        <input
          autoFocus inputMode="numeric" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") void pair(); }}
          placeholder="123456"
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-3 text-center font-mono text-3xl tracking-[0.4em] outline-none focus:border-sky-500"
        />
        {err ? <p className="text-sm text-rose-400">{err}</p> : null}
        <button type="button" onClick={() => void pair()} disabled={busy} className="w-full rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60">Pair</button>
      </Center>
    );
  }

  // phase === "ready"
  if (!bundle) return <Center><h1 className="text-lg font-semibold">Connecting…</h1></Center>;
  if (!bundle.layout) {
    return (
      <Center>
        <h1 className="text-xl font-semibold">{bundle.name}</h1>
        <p className="text-sm text-slate-400">No wallboard is assigned yet. Assign one (or this device's group) in <span className="text-slate-200">Admin → Display devices</span> — it will appear here automatically.</p>
        <button type="button" onClick={unpair} className="text-xs text-slate-500 underline hover:text-slate-300">Unpair</button>
      </Center>
    );
  }
  return <WallboardKiosk forcedLayoutId={bundle.layout.id} />;
}
