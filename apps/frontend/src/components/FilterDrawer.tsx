/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Right-side filter drawer. Renders a "Filters" toggle button (with a count badge
 * when any filter is active) that opens a slide-in panel holding the filter fields,
 * plus a Reset action. Keeps the page header clean and gives a clear "filters
 * applied" indication, consistent across every table.
 */
import { useState, type ReactNode } from "react";
import { Filter, X } from "lucide-react";
import { useEscape } from "@/hooks/useEscape";

interface FilterDrawerProps {
  /** How many filters are currently active — shown as a badge + drives styling. */
  appliedCount: number;
  onReset: () => void;
  /** The filter fields (inputs/selects). */
  children: ReactNode;
}

export function FilterDrawer({ appliedCount, onReset, children }: FilterDrawerProps) {
  const [open, setOpen] = useState(false);
  const active = appliedCount > 0;
  useEscape(() => setOpen(false), open);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
          active
            ? "border-sky-500/50 bg-sky-500/10 text-sky-200"
            : "border-slate-700 text-slate-300 hover:border-slate-500"
        }`}
      >
        <Filter size={15} />
        Filters
        {active ? (
          <span className="ml-0.5 rounded-full bg-sky-500/30 px-1.5 text-xs text-sky-100">{appliedCount}</span>
        ) : null}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" onMouseDown={() => setOpen(false)}>
          <div className="absolute inset-0 bg-slate-950/60" />
          <aside
            className="relative flex h-full w-full max-w-sm flex-col border-l border-slate-800 bg-slate-900 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <h2 className="text-base font-semibold text-slate-100">Filters</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-5 py-3">
              <button
                type="button"
                onClick={onReset}
                disabled={!active}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:border-slate-500 disabled:opacity-50"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-500"
              >
                Done
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
