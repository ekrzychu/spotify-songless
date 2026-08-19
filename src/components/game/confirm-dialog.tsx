"use client";

import { useRef } from "react";
import { useDialogFocus } from "@/hooks/use-dialog-focus";

export function ConfirmDialog({
  onCancel,
  onConfirm,
  title = "Start a new song?",
  description = "Your progress on this song will be left behind.",
  cancelLabel = "Keep playing",
  confirmLabel = "Start new song",
}: {
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  cancelLabel?: string;
  confirmLabel?: string;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const handleKeyDown = useDialogFocus(panelRef, cancelRef, onCancel);
  return (
    <div className="confirm-backdrop" role="presentation">
      <section
        ref={panelRef}
        className="confirm-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        onKeyDown={handleKeyDown}
      >
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-description">{description}</p>
        <div>
          <button ref={cancelRef} type="button" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
