/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Reusable confirmation dialog for destructive / sensitive actions. Replaces the
 * native window.confirm so every "are you sure?" looks like the rest of the app,
 * supports a danger styling, and can surface an async error in place. Built on the
 * shared Modal; the confirm button shows a busy state while onConfirm resolves.
 */
import { useState, type ReactNode } from "react";
import { Modal } from "@/components/Modal";

interface ConfirmDialogProps {
  title: string;
  /** Body copy — a string or richer node (e.g. a list of references). */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for irreversible actions (delete/revoke). Default true. */
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={busy ? () => {} : onCancel}>
      <div className="space-y-4">
        <div className="text-sm text-slate-300">{message}</div>
        {error ? (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:border-slate-500 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className={
              danger
                ? "rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-60"
                : "rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
            }
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
