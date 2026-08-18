"use client";

import { useRef } from "react";
import type { AnswerView } from "@/types/game";
import { useDialogFocus } from "@/hooks/use-dialog-focus";

export function ResultPanel({ won, attempts, answer, onNext }: {
  won: boolean; attempts: number; answer: AnswerView; onNext: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const handleKeyDown = useDialogFocus(panelRef, nextRef);
  return (
    <div className="result-backdrop" role="presentation">
      <section
        ref={panelRef}
        className="result-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-title"
        aria-describedby="result-summary"
        onKeyDown={handleKeyDown}
      >
        <div className="result-artwork" aria-hidden="true">
          <span className="result-record" />
          <span className="result-sleeve-mark">S</span>
        </div>
        <p className="result-eyebrow" id="result-summary">It was...</p>
        <h2 id="result-title">{answer.title}</h2>
        <p className="result-artist">{answer.artistNames}</p>
        <p className="result-album">{answer.albumName}</p>
        <p className={`result-outcome${won ? " is-win" : " is-loss"}`}>
          {won ? `Solved in ${attempts} / 6` : "Not solved"}
        </p>
        <dl className="result-meta">
          <div><dt>Attempts</dt><dd>{attempts} / 6</dd></div>
          <div><dt>Streams</dt><dd>{answer.streamCount ? Number(answer.streamCount).toLocaleString() : "Unranked"}</dd></div>
        </dl>
        <a className="spotify-link" href={answer.spotifyUrl} target="_blank" rel="noreferrer">Open in Spotify <span aria-hidden="true">↗</span></a>
        <button ref={nextRef} className="next-button" type="button" onClick={onNext}>Next Song</button>
      </section>
    </div>
  );
}
