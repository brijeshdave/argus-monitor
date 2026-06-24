/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * A compact chip-style multi-select used by the user and group editors to assign
 * groups / roles. Toggling a chip adds or removes it; shows a selected count.
 */
export interface ChipOption {
  id: string;
  name: string;
}

export function ChipMultiSelect({
  options,
  selected,
  onChange,
  disabled = false,
  emptyNote = "Nothing available.",
}: {
  options: ChipOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  emptyNote?: string;
}) {
  const toggle = (id: string) => {
    if (disabled) return;
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  if (options.length === 0) {
    return <p className="rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-600">{emptyNote}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            onClick={() => toggle(o.id)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-sky-500/50 bg-sky-500/15 text-sky-200" : "border-slate-700 text-slate-300 hover:border-slate-500"}`}
          >
            {on ? "✓ " : ""}{o.name}
          </button>
        );
      })}
    </div>
  );
}
