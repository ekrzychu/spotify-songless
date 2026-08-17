"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SearchTrack } from "@/types/game";

const searchCache = new Map<string, SearchTrack[]>();

export function GuessSearch({ disabled, busy, onAttempt }: {
  disabled: boolean;
  busy: boolean;
  onAttempt: (track: SearchTrack | null) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchTrack[]>([]);
  const [selected, setSelected] = useState<SearchTrack | null>(null);
  const [highlighted, setHighlighted] = useState(-1);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selected || query.trim().length < 2) return;
    const normalized = query.trim().toLowerCase();
    const cached = searchCache.get(normalized);
    if (cached) {
      queueMicrotask(() => { setResults(cached); setOpen(true); });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/spotify/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<{ items: SearchTrack[] }> : Promise.reject())
        .then(({ items }) => {
          searchCache.set(normalized, items);
          if (searchCache.size > 30) searchCache.delete(searchCache.keys().next().value ?? "");
          setResults(items); setHighlighted(items.length ? 0 : -1); setOpen(true);
        })
        .catch(() => { if (!controller.signal.aborted) { setResults([]); setOpen(true); } });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, selected]);

  const choose = (track: SearchTrack) => {
    setSelected(track); setQuery(`${track.title} — ${track.artistNames}`); setOpen(false);
  };

  const submit = () => {
    onAttempt(selected);
    setSelected(null); setQuery(""); setResults([]); setOpen(false); setHighlighted(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="guess-row">
      <div className="search-wrap">
        <input
          ref={inputRef}
          value={query}
          disabled={disabled || busy}
          placeholder="Search for a song…"
          aria-label="Search for a song"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
          autoComplete="off"
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value); setSelected(null);
            if (value.trim().length < 2) { setResults([]); setOpen(false); setHighlighted(-1); }
          }}
          onFocus={() => { if (results.length) setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setOpen(false); return; }
            if (event.key === "ArrowDown" && results.length) {
              event.preventDefault(); setOpen(true); setHighlighted((value) => (value + 1) % results.length);
            }
            if (event.key === "ArrowUp" && results.length) {
              event.preventDefault(); setHighlighted((value) => (value <= 0 ? results.length - 1 : value - 1));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (selected) submit();
              else if (open && highlighted >= 0 && results[highlighted]) choose(results[highlighted]);
            }
          }}
        />
        {selected && <button className="clear-guess" type="button" aria-label="Clear selected song" onClick={() => { setSelected(null); setQuery(""); inputRef.current?.focus(); }}>×</button>}
        {open && (
          <ul className="search-results" id={listId} role="listbox">
            {results.length ? results.map((track, index) => (
              <li
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === highlighted}
                className={index === highlighted ? "is-highlighted" : ""}
                key={`${track.spotifyTrackId}-${index}`}
                onMouseDown={(event) => { event.preventDefault(); choose(track); }}
                onMouseEnter={() => setHighlighted(index)}
              >
                <span>{track.title}</span><small>{track.artistNames}</small>
              </li>
            )) : <li className="search-empty">No tracks found</li>}
          </ul>
        )}
      </div>
      <button className={selected ? "attempt-button attempt-button--submit" : "attempt-button"} disabled={disabled || busy} type="button" onClick={submit}>
        {busy ? "Wait" : selected ? "Submit" : "Skip"}
      </button>
    </div>
  );
}
