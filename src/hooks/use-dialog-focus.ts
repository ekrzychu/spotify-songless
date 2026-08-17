"use client";

import { useEffect, type KeyboardEvent, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus(
  containerRef: RefObject<HTMLElement | null>,
  initialFocusRef: RefObject<HTMLElement | null>,
  onEscape?: () => void,
) {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => initialFocusRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      requestAnimationFrame(() => previous?.focus());
    };
  }, [initialFocusRef]);

  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); onEscape?.();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  };
}
