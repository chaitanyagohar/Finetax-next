"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { X, AlertTriangle, Loader2 } from "lucide-react";

/**
 * Shared dialog behaviour: Escape closes, the page behind doesn't scroll, focus moves into the
 * dialog and goes back to whatever was focused before when it closes.
 */
function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const box = ref.current;
    if (box && !box.contains(document.activeElement)) {
      // A form field first; the dialog itself otherwise, so a stray Enter doesn't press a button
      const first = box.querySelector<HTMLElement>("[autofocus]") || box.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select, textarea");
      (first || box).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  return ref;
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  headerExtra,
  maxWidth = "max-w-xl",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headerExtra?: ReactNode;
  maxWidth?: string;
}) {
  const ref = useDialog(onClose);
  const titleId = useId();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 animate-fade-in sm:p-4">
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-[95vh] w-full ${maxWidth} flex-col rounded-xl border border-border bg-surface shadow-2xl outline-none animate-scale-in`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-semibold text-text-main">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
            {headerExtra}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition hover:bg-surface-alt hover:text-text-main"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">{children}</div>

        {footer && <div className="shrink-0 rounded-b-xl border-t border-border bg-surface px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  loading = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useDialog(() => {
    if (!loading) onCancel();
  });
  const titleId = useId();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 animate-fade-in">
      <div
        ref={ref}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-2xl outline-none animate-scale-in"
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              tone === "danger" ? "bg-rose-50 text-rose-600" : "bg-navy/10 text-navy"
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 id={titleId} className="text-sm font-semibold text-text-main">{title}</h3>
            <div className="mt-1 text-xs text-text-muted">{message}</div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-sm transition disabled:opacity-60 ${
              tone === "danger" ? "bg-danger hover:opacity-90" : "bg-navy hover:bg-navy-light"
            }`}
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}