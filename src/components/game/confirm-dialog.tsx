"use client";

import { useRef } from "react";
import { useDialogFocus } from "@/hooks/use-dialog-focus";

export function ConfirmDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
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
        <h2 id="confirm-title">Start a new song?</h2>
        <p id="confirm-description">Your progress on this song will be left behind.</p>
        <div>
          <button ref={cancelRef} type="button" onClick={onCancel}>Keep playing</button>
          <button type="button" onClick={onConfirm}>Start new song</button>
        </div>
      </section>
    </div>
  );
}
