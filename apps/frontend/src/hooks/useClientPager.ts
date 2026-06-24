/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Client-side pager for load-all tables (agents, keys, backups…) that already have
 * every row in memory. Returns the current page slice plus a control object shaped
 * exactly like the server-side pager's, so the shared <Pager/> renders both. Resets
 * to the first page whenever the underlying row count shrinks (e.g. filtering).
 */
import { useEffect, useMemo, useState } from "react";

export interface ClientPager<T> {
  pageRows: T[];
  list: {
    page: number;
    pageCount: number;
    total: number;
    offset: number;
    limit: number;
    setOffset: (offset: number) => void;
    next: () => void;
    prev: () => void;
  };
}

export function useClientPager<T>(rows: T[], limit = 25): ClientPager<T> {
  const [offset, setOffset] = useState(0);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  // Keep the offset in range when the row set changes (filter/refresh).
  useEffect(() => {
    if (offset >= total && total > 0) setOffset((pageCount - 1) * limit);
    else if (total === 0) setOffset(0);
  }, [total, offset, pageCount, limit]);

  const pageRows = useMemo(() => rows.slice(offset, offset + limit), [rows, offset, limit]);
  const page = Math.floor(offset / limit) + 1;

  return {
    pageRows,
    list: {
      page,
      pageCount,
      total,
      offset,
      limit,
      setOffset,
      next: () => setOffset((o) => (o + limit < total ? o + limit : o)),
      prev: () => setOffset((o) => Math.max(0, o - limit)),
    },
  };
}
