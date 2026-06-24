/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Tiny centered loading spinner.
 */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="grid min-h-[40vh] place-items-center text-slate-400">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
        {label ? <span className="text-sm">{label}</span> : null}
      </div>
    </div>
  );
}
