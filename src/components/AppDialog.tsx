"use client";

import { useEffect, useId, useRef } from "react";

export interface AppDialogProps {
  open: boolean;
  title: string;
  message: string;
  kind?: "alert" | "confirm";
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

/** Diálogo visual compartilhado para substituir alert/confirm nativos. */
export default function AppDialog({
  open,
  title,
  message,
  kind = "alert",
  confirmLabel = "Entendi",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
}: AppDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const messageId = `${dialogId}-message`;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const frame = window.requestAnimationFrame(() => confirmRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onCancel) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel, open]);

  if (!open) return null;

  return (
    <div
      className="app-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && onCancel) onCancel();
      }}
    >
      <section
        className={`app-dialog app-dialog-${kind}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <span className="app-dialog-mark" aria-hidden="true">{kind === "confirm" ? "?" : "!"}</span>
        <div className="app-dialog-content">
          <h2 id={titleId}>{title}</h2>
          <p id={messageId}>{message}</p>
        </div>
        <div className="app-dialog-actions">
          {kind === "confirm" && onCancel && (
            <button type="button" className="app-dialog-button app-dialog-button-secondary" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button ref={confirmRef} type="button" className="app-dialog-button app-dialog-button-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
