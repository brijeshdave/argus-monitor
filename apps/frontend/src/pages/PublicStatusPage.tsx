/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Public, UNAUTHENTICATED status page. Chrome-less and token-free: it fetches
 * /api/public/status with the raw `fetch` API (NOT the auth client, since there is
 * no session). A 404 means the page is disabled — shown as a neutral message.
 * Only coarse, server-whitelisted fields (label/status/uptime/history) are ever
 * rendered. Wide layout: overall banner, named groups, per-item uptime sparklines.
 * Auto-refreshes on a timer so a wall-mounted page stays current.
 */
import { useEffect, useState } from "react";
import type { HealthStatus, PublicStatusDTO, PublicStatusGroup, PublicStatusItem } from "@argus/shared";
import { StatusBadge } from "@/components/StatusBadge";

type LoadState =
  | { kind: "loading" }
  | { kind: "disabled" }
  | { kind: "error" }
  | { kind: "ready"; data: PublicStatusDTO };

const REFRESH_MS = 60_000;

/** Banner copy + tone per overall rollup. */
const BANNER: Record<HealthStatus, { text: string; ring: string; bg: string; dot: string }> = {
  UP: { text: "All systems operational", ring: "border-emerald-500/40", bg: "bg-emerald-500/10", dot: "bg-emerald-400" },
  DEGRADED: { text: "Some systems degraded", ring: "border-amber-500/40", bg: "bg-amber-500/10", dot: "bg-amber-400" },
  HANG: { text: "Some systems not responding", ring: "border-amber-500/40", bg: "bg-amber-500/10", dot: "bg-amber-400" },
  DOWN: { text: "Major service outage", ring: "border-rose-500/40", bg: "bg-rose-500/10", dot: "bg-rose-400" },
  UNKNOWN: { text: "Status unknown", ring: "border-slate-700", bg: "bg-slate-800/40", dot: "bg-slate-500" },
};

/** Operator-banner styling per level. */
const NOTICE: Record<"info" | "maintenance" | "incident", { label: string; ring: string; bg: string; text: string }> = {
  info: { label: "Notice", ring: "border-sky-500/40", bg: "bg-sky-500/10", text: "text-sky-200" },
  maintenance: { label: "Scheduled maintenance", ring: "border-amber-500/40", bg: "bg-amber-500/10", text: "text-amber-200" },
  incident: { label: "Active incident", ring: "border-rose-500/40", bg: "bg-rose-500/10", text: "text-rose-200" },
};

/** Bar colour for a single day's uptime percentage (null = no data). */
function barColor(pct: number | null): string {
  if (pct === null) return "#1e293b"; // slate-800 — no data
  if (pct >= 99.5) return "#22c55e";
  if (pct >= 95) return "#84cc16";
  if (pct >= 80) return "#f59e0b";
  return "#ef4444";
}

/** A compact daily-uptime sparkline rendered with plain divs (no chart lib). */
function Sparkline({ history }: { history: Array<number | null> }) {
  const known = history.filter((d): d is number => d !== null);
  const avg = known.length ? Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 10) / 10 : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-[2px]" style={{ height: 28 }}>
        {history.map((pct, i) => (
          <div
            key={i}
            title={pct === null ? "No data" : `${pct}% uptime`}
            className="flex-1 rounded-[1px]"
            style={{
              minWidth: 2,
              height: pct === null ? "100%" : `${Math.max(8, pct)}%`,
              background: barColor(pct),
              opacity: pct === null ? 0.5 : 1,
            }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-600">
        <span>{history.length}d ago</span>
        {avg !== null ? <span className="text-slate-500">{avg}% avg</span> : <span />}
        <span>today</span>
      </div>
    </div>
  );
}

function ItemRow({ item }: { item: PublicStatusItem }) {
  return (
    <li className="grid grid-cols-1 items-center gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:gap-6">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <StatusBadge status={item.status} />
          <span className="truncate text-sm font-medium text-slate-100">{item.label}</span>
          {item.uptimePct !== undefined ? (
            <span className="ml-auto whitespace-nowrap text-xs text-slate-500 sm:ml-0">{item.uptimePct}% uptime</span>
          ) : null}
        </div>
      </div>
      {item.history && item.history.length > 0 ? (
        <div className="w-full sm:w-64">
          <Sparkline history={item.history} />
        </div>
      ) : (
        <div className="hidden sm:block sm:w-64" />
      )}
    </li>
  );
}

function GroupSection({ group }: { group: PublicStatusGroup }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      {group.name ? (
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/60 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">{group.name}</h2>
          <StatusBadge status={group.status} />
        </div>
      ) : null}
      {group.items.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-500">No components reported.</div>
      ) : (
        <ul className="divide-y divide-slate-800">
          {group.items.map((item, i) => (
            <ItemRow key={i} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function PublicStatusPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load(initial: boolean) {
      try {
        const res = await fetch("/api/public/status");
        if (res.status === 404) {
          if (!cancelled) setState({ kind: "disabled" });
          return;
        }
        if (!res.ok) {
          if (!cancelled && initial) setState({ kind: "error" });
          return;
        }
        const data = (await res.json()) as PublicStatusDTO;
        if (!cancelled) setState({ kind: "ready", data });
      } catch {
        if (!cancelled && initial) setState({ kind: "error" });
      }
    }
    void load(true);
    const t = setInterval(() => void load(false), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        {state.kind === "loading" ? (
          <p className="text-center text-sm text-slate-500">Loading status…</p>
        ) : null}

        {state.kind === "disabled" ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-6 py-12 text-center text-sm text-slate-400">
            The public status page is not currently available.
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-6 py-12 text-center text-sm text-rose-300">
            Unable to load status right now. Please try again later.
          </div>
        ) : null}

        {state.kind === "ready" ? (
          <>
            <header className="space-y-2 text-center">
              <h1 className="text-3xl font-bold tracking-tight">{state.data.title}</h1>
              {state.data.description ? (
                <p className="mx-auto max-w-2xl text-sm text-slate-400">{state.data.description}</p>
              ) : null}
            </header>

            {/* Operator notice (incident / maintenance / info) */}
            {state.data.notice?.message ? (
              <div className={`rounded-xl border px-5 py-4 ${NOTICE[state.data.notice.level].ring} ${NOTICE[state.data.notice.level].bg}`}>
                <div className={`text-xs font-semibold uppercase tracking-wide ${NOTICE[state.data.notice.level].text}`}>
                  {NOTICE[state.data.notice.level].label}
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-200">{state.data.notice.message}</p>
              </div>
            ) : null}

            {/* Overall banner */}
            <div className={`flex items-center gap-3 rounded-xl border px-5 py-4 ${BANNER[state.data.overall].ring} ${BANNER[state.data.overall].bg}`}>
              <span className={`h-3 w-3 shrink-0 rounded-full ${BANNER[state.data.overall].dot}`} />
              <span className="text-base font-semibold text-slate-100">{BANNER[state.data.overall].text}</span>
              <StatusBadge status={state.data.overall} />
            </div>

            {state.data.groups.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-6 py-10 text-center text-sm text-slate-500">
                No components are being reported.
              </div>
            ) : (
              <div className="space-y-5">
                {state.data.groups.map((g, i) => (
                  <GroupSection key={`${g.name}:${i}`} group={g} />
                ))}
              </div>
            )}

            {/* Legend */}
            <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "#22c55e" }} /> Operational</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "#f59e0b" }} /> Degraded</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "#ef4444" }} /> Outage</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm opacity-50" style={{ background: "#1e293b" }} /> No data</span>
            </div>

            <p className="text-center text-xs text-slate-600">
              Updated {new Date(state.data.generatedAt).toLocaleString()} · refreshes automatically
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
