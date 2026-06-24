/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Reusable history period selector: preset short/long windows plus a custom "since"
 * date. Emits a query fragment ("hours=24" or "from=<iso>") that the metric history
 * endpoints understand, so any chart can offer consistent period control.
 */
import { useState } from "react";

export const PERIOD_PRESETS: Array<{ label: string; query: string }> = [
  { label: "24h", query: "hours=24" },
  { label: "7d", query: "hours=168" },
  { label: "30d", query: "hours=720" },
  { label: "3mo", query: "hours=2160" },
  { label: "6mo", query: "hours=4320" },
  { label: "1y", query: "hours=8760" },
  { label: "2y", query: "hours=17520" },
  { label: "3y", query: "hours=26280" },
  { label: "4y", query: "hours=35040" },
  { label: "5y", query: "hours=43800" },
];

export function PeriodSelector({ value, onChange }: { value: string; onChange: (query: string) => void }) {
  const [custom, setCustom] = useState("");
  const isCustom = value.startsWith("from=");
  return (
    <div className="flex flex-wrap items-center gap-1">
      {PERIOD_PRESETS.map((p) => (
        <button
          key={p.query}
          type="button"
          onClick={() => onChange(p.query)}
          className={`rounded-md px-2 py-0.5 text-xs transition-colors ${value === p.query ? "bg-sky-500 text-slate-950" : "border border-slate-700 text-slate-300 hover:border-slate-500"}`}
        >
          {p.label}
        </button>
      ))}
      <label className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs ${isCustom ? "border-sky-500 text-slate-100" : "border-slate-700 text-slate-400"}`}>
        <span>Since</span>
        <input
          type="date"
          value={custom}
          onChange={(e) => { setCustom(e.target.value); if (e.target.value) onChange(`from=${new Date(e.target.value).toISOString()}`); }}
          className="bg-transparent text-xs text-slate-200 outline-none"
        />
      </label>
    </div>
  );
}
