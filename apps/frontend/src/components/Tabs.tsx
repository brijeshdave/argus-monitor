/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Small reusable tab bar — renders only the active panel so long detail views
 * (SNMP / database / storage / reports) become tabbed instead of one long scroll.
 */
import { useState, type ReactNode } from "react";

export interface TabItem {
  key: string;
  label: string;
  node: ReactNode;
}

export function Tabs({ items, className = "" }: { items: TabItem[]; className?: string }) {
  const [active, setActive] = useState(items[0]?.key ?? "");
  const current = items.find((i) => i.key === active) ?? items[0];
  if (items.length === 0) return null;
  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap gap-1 border-b border-slate-800">
        {items.map((i) => (
          <button
            key={i.key}
            type="button"
            onClick={() => setActive(i.key)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
              current?.key === i.key ? "border-sky-400 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {i.label}
          </button>
        ))}
      </div>
      <div>{current?.node}</div>
    </div>
  );
}
