/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Shared table pager: numbered pages (windowed with ellipses) plus Prev/Next, used
 * across the telemetry tables. Backed by usePagedList (offset/limit/total).
 */

interface PagerList {
  page: number;
  pageCount: number;
  total: number;
  offset: number;
  limit: number;
  setOffset: (offset: number) => void;
  next: () => void;
  prev: () => void;
}

/** Page numbers to render: first, last, a window around current, with "…" gaps. */
function pageItems(page: number, pageCount: number): Array<number | "…"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out: Array<number | "…"> = [1];
  const lo = Math.max(2, page - 1);
  const hi = Math.min(pageCount - 1, page + 1);
  if (lo > 2) out.push("…");
  for (let p = lo; p <= hi; p += 1) out.push(p);
  if (hi < pageCount - 1) out.push("…");
  out.push(pageCount);
  return out;
}

export function Pager({ list }: { list: PagerList }) {
  const go = (p: number) => list.setOffset((p - 1) * list.limit);
  const btn = "rounded-md border border-slate-700 px-2.5 py-1 text-xs transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3 text-sm text-slate-400">
      <span>{list.total} total</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={list.prev} disabled={list.offset === 0} className={btn}>Prev</button>
        {pageItems(list.page, list.pageCount).map((p, i) =>
          p === "…" ? (
            <span key={`gap${i}`} className="px-1.5 text-xs text-slate-600">…</span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => go(p)}
              aria-current={p === list.page ? "page" : undefined}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                p === list.page ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40" : "border border-slate-700 hover:border-slate-500"
              }`}
            >
              {p}
            </button>
          ),
        )}
        <button type="button" onClick={list.next} disabled={list.page >= list.pageCount} className={btn}>Next</button>
      </div>
    </div>
  );
}
