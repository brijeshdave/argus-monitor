/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Client-side table sorting for load-all tables (users, agents, monitors…). useSort
 * returns the sorted rows + current key/dir and a toggle; SortHeader renders a
 * clickable <th> with a direction caret. Strings sort case-insensitively, numbers
 * numerically, with nullish values pushed to the end.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";

export type SortDir = "asc" | "desc";

export interface Sort<K extends string> {
  key: K | null;
  dir: SortDir;
  toggle: (key: K) => void;
}

function compare(a: unknown, b: unknown): number {
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an && bn) return 0;
  if (an) return 1; // nullish last
  if (bn) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
}

/** Sort `rows` by the active key; `accessor` maps (row,key) → comparable value. */
export function useSort<T, K extends string>(
  rows: T[],
  accessor: (row: T, key: K) => unknown,
  initial?: { key: K; dir?: SortDir },
): { sorted: T[]; sort: Sort<K> } {
  const [key, setKey] = useState<K | null>(initial?.key ?? null);
  const [dir, setDir] = useState<SortDir>(initial?.dir ?? "asc");

  const toggle = (k: K) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(k);
      setDir("asc");
    }
  };

  const sorted = useMemo(() => {
    if (!key) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const c = compare(accessor(a, key), accessor(b, key));
      return dir === "asc" ? c : -c;
    });
    return copy;
  }, [rows, key, dir, accessor]);

  return { sorted, sort: { key, dir, toggle } };
}

/** A clickable, sortable column header cell. */
export function SortHeader<K extends string>({
  label, sortKey, sort, className = "",
}: {
  label: string; sortKey: K; sort: Sort<K>; className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <th className={`px-4 py-3 font-medium ${className}`}>
      <button
        type="button"
        onClick={() => sort.toggle(sortKey)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-slate-200 ${active ? "text-slate-200" : ""}`}
      >
        {label}
        <Icon size={13} className={active ? "text-sky-300" : "text-slate-600"} />
      </button>
    </th>
  );
}
