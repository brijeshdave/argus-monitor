/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Fixed bottom ticker bar — a bold, attention-grabbing marquee of the live ticker
 * messages. Polls GET /api/ticker/active every 30s (which also carries the global
 * scroll SPEED in px/sec). Messages ENTER FROM THE RIGHT EDGE and scroll left
 * (classic news ticker); the duration is derived from the measured content width so
 * the px/sec speed is consistent regardless of message length. The bar is tinted by
 * the loudest active severity; CRITICAL messages are larger and blink. Renders
 * nothing when unauthenticated or idle.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertOctagon, AlertTriangle, Info, Megaphone, type LucideIcon } from "lucide-react";
import { TICKER_SPEED_DEFAULT, type TickerMessageDTO, type TickerSeverity } from "@argus/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/auth/AuthContext";

interface ActiveResponse { rows: TickerMessageDTO[]; speed?: number }

const POLL_MS = 30_000;
const SEV_RANK: Record<TickerSeverity, number> = { info: 0, warning: 1, critical: 2 };

const SEV: Record<TickerSeverity, { text: string; icon: LucideIcon }> = {
  info: { text: "text-sky-200", icon: Info },
  warning: { text: "text-amber-200", icon: AlertTriangle },
  critical: { text: "text-rose-200", icon: AlertOctagon },
};

/** Bar theme (gradient + accent) keyed to the loudest active severity. */
const BAR: Record<TickerSeverity, { wrap: string; lead: string; leadBlink: boolean }> = {
  info: { wrap: "from-sky-950/95 via-slate-950/95 to-sky-950/95 border-sky-500/40", lead: "bg-sky-500/20 text-sky-100", leadBlink: false },
  warning: { wrap: "from-amber-950/95 via-slate-950/95 to-amber-950/95 border-amber-500/50", lead: "bg-amber-500/25 text-amber-50", leadBlink: false },
  critical: { wrap: "from-rose-950/95 via-slate-950/95 to-rose-950/95 border-rose-500/70", lead: "bg-rose-600/40 text-white", leadBlink: true },
};

/** Self-contained polling hook → active messages + global scroll speed (px/sec). */
function useActiveTicker(enabled: boolean): { messages: TickerMessageDTO[]; speed: number } {
  const [messages, setMessages] = useState<TickerMessageDTO[]>([]);
  const [speed, setSpeed] = useState<number>(TICKER_SPEED_DEFAULT);

  useEffect(() => {
    if (!enabled) { setMessages([]); return; }
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api.get<ActiveResponse>("/api/ticker/active");
        if (cancelled) return;
        setMessages(res.rows);
        if (typeof res.speed === "number") setSpeed(res.speed);
      } catch {
        if (!cancelled) setMessages([]);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled]);

  return { messages, speed };
}

export function TickerBar() {
  const { status } = useAuth();
  const authed = status === "authed";
  const { messages, speed } = useActiveTicker(authed);

  const innerRef = useRef<HTMLDivElement>(null);
  const [durationSec, setDurationSec] = useState(20);

  // The scrolling element has padding-left:100% (one viewport), so content starts at
  // the RIGHT edge and scrolls fully left. Its scrollWidth = viewport + content, and
  // translateX(-100%) travels exactly that far → duration = scrollWidth / speed keeps
  // the configured px/sec constant.
  useLayoutEffect(() => {
    const w = innerRef.current?.scrollWidth ?? 0;
    if (w > 0 && speed > 0) setDurationSec(Math.max(4, w / speed));
  }, [messages, speed]);

  if (!authed || messages.length === 0) return null;

  const top = messages.reduce<TickerSeverity>((acc, m) => (SEV_RANK[m.severity] > SEV_RANK[acc] ? m.severity : acc), "info");
  const theme = BAR[top];

  return (
    <div className={`fixed inset-x-0 bottom-0 z-40 overflow-hidden border-t-2 bg-gradient-to-r ${theme.wrap} ${top === "critical" ? "animate-tk-pulse" : ""} shadow-[0_-4px_24px_rgba(0,0,0,0.45)] backdrop-blur`}>
      <style>{`
        @keyframes argus-marquee{from{transform:translateX(0)}to{transform:translateX(-100%)}}
        @keyframes argus-blink{0%,100%{opacity:1}50%{opacity:.35}}
        @keyframes argus-tk-pulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.18)}}
        .animate-tk-pulse{animation:argus-tk-pulse 1.6s ease-in-out infinite}
        .animate-tk-blink{animation:argus-blink 1s step-start infinite}
      `}</style>

      {/* Fixed leading badge — always visible, signals "announcement". */}
      <span className={`absolute left-0 top-0 z-10 flex h-full items-center gap-2 px-4 text-sm font-extrabold uppercase tracking-widest ${theme.lead} ${theme.leadBlink ? "animate-tk-blink" : ""} shadow-lg`}>
        <Megaphone size={20} /> Notice
      </span>

      {/* Single run, padded a full viewport so it enters from the right edge. */}
      <div
        ref={innerRef}
        className="inline-block whitespace-nowrap py-3 text-lg leading-none"
        style={{ paddingLeft: "100%", animation: `argus-marquee ${durationSec}s linear infinite` }}
      >
        {messages.map((m) => {
          const Icon = SEV[m.severity].icon;
          const crit = m.severity === "critical";
          return (
            <span key={m.id} className={`mx-10 inline-flex items-center gap-2.5 align-middle ${crit ? "animate-tk-blink" : ""}`}>
              <Icon size={crit ? 26 : 20} className={`shrink-0 ${SEV[m.severity].text}`} />
              <span className={`font-bold tracking-wide ${m.severity === "info" ? "text-slate-50" : SEV[m.severity].text} ${crit ? "text-2xl uppercase" : "text-lg"}`}>{m.text}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
