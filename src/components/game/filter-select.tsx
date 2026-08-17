"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type RefObject } from "react";

export type FilterOption = { value: string; label: string };
export type FilterGroup = { label: string; options: FilterOption[] };

export function FilterSelect({
  label, value, groups, open, disabled, menuAlign = "start", onOpen, onClose, onChange,
}: {
  label: string;
  value: string;
  groups: FilterGroup[];
  open: boolean;
  disabled?: boolean;
  menuAlign?: "start" | "end";
  onOpen: () => void;
  onClose: () => void;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const options = groups.flatMap((group) => group.options);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const selectedOption = optionRefs.current.get(value) ?? optionRefs.current.get(options[0]?.value ?? "");
    requestAnimationFrame(() => selectedOption?.focus());
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [onClose, open, options, value]);

  const move = (current: string, direction: 1 | -1) => {
    const index = Math.max(options.findIndex((option) => option.value === current), 0);
    const next = options[(index + direction + options.length) % options.length];
    if (next) optionRefs.current.get(next.value)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const current = (document.activeElement as HTMLElement | null)?.dataset.value ?? value;
    if (event.key === "Escape") {
      event.preventDefault(); onClose(); triggerRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); move(current, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const option = event.key === "Home" ? options[0] : options.at(-1);
      if (option) optionRefs.current.get(option.value)?.focus();
    }
  };

  return (
    <div
      className="filter-control"
      ref={rootRef}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onClose(); }}
    >
      <button
        ref={triggerRef}
        className="filter-trigger"
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => open ? onClose() : onOpen()}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault(); onOpen();
          }
        }}
      >
        <span>{selected?.label ?? value}</span><i aria-hidden="true" />
      </button>
      {open && (
        <div
          id={`${id}-listbox`}
          className={`filter-menu filter-menu--${menuAlign}`}
          role="listbox"
          aria-label={label}
          onKeyDown={handleKeyDown}
        >
          {groups.map((group, groupIndex) => (
            <div className="filter-group" role="group" aria-labelledby={`${id}-group-${groupIndex}`} key={group.label}>
              <div className="filter-group-label" id={`${id}-group-${groupIndex}`}>{group.label}</div>
              {group.options.map((option) => (
                <button
                  ref={(node) => setOptionRef(optionRefs, option.value, node)}
                  id={`${id}-${option.value}`}
                  data-value={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  tabIndex={-1}
                  key={option.value}
                  onClick={() => { onChange(option.value); onClose(); triggerRef.current?.focus(); }}
                >
                  <span className="filter-check" aria-hidden="true">{option.value === value ? "✓" : ""}</span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function setOptionRef(
  refs: RefObject<Map<string, HTMLButtonElement>>,
  value: string,
  node: HTMLButtonElement | null,
): void {
  if (node) refs.current.set(value, node);
  else refs.current.delete(value);
}
