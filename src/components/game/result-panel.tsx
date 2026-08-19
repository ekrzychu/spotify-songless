"use client";

import { useRef } from "react";
import type { AnswerView } from "@/types/game";
import { useDialogFocus } from "@/hooks/use-dialog-focus";
import { GAME_DIFFICULTY_LABELS } from "@/lib/game/difficulty";

export function ResultPanel({ won, attempts, answer, artworkUrl, playbackWarning, onClose, onNext, onTryHigher }: {
  won: boolean;
  attempts: number;
  answer: AnswerView;
  artworkUrl?: string | null;
  playbackWarning?: string | null;
  onClose: () => void;
  onNext: () => void;
  onTryHigher?: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const handleKeyDown = useDialogFocus(panelRef, nextRef, onClose);
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
        <button className="result-close" type="button" aria-label="Close result" onClick={onClose}>×</button>
        {artworkUrl ? (
          <div className="result-artwork">
            {/* SDK metadata is the source; no per-result Spotify Web API lookup is made. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={artworkUrl} alt={`${answer.albumName} cover`} />
          </div>
        ) : (
          <div className="result-artwork result-artwork--placeholder" aria-hidden="true">
            <span className="result-record" />
            <span className="result-sleeve-mark">S</span>
          </div>
        )}
        <p className="result-eyebrow" id="result-summary">It was...</p>
        <h2 id="result-title">{answer.title}</h2>
        <p className="result-artist">{answer.artistNames}</p>
        <p className="result-album">{answer.albumName}</p>
        <p className={`result-outcome${won ? " is-win" : " is-loss"}`}>
          {won ? `Solved in ${attempts} / 6` : "Not solved"}
        </p>
        <dl className="result-meta">
          <div><dt>Attempts</dt><dd>{attempts} / 6</dd></div>
          <div><dt>Difficulty</dt><dd>{GAME_DIFFICULTY_LABELS[answer.difficulty]}</dd></div>
          <div><dt>Streams</dt><dd>{answer.difficulty === "unranked" || answer.streamCount === null ? "Not ranked yet" : Number(answer.streamCount).toLocaleString()}</dd></div>
        </dl>
        <a className="spotify-link" href={answer.spotifyUrl} target="_blank" rel="noreferrer">Open in Spotify <span aria-hidden="true">↗</span></a>
        {playbackWarning && <p className="result-playback-warning" role="status">{playbackWarning}</p>}
        <button ref={nextRef} className="next-button" type="button" onClick={onNext}>Next Song</button>
        {won && onTryHigher && (
          <button className="higher-button" type="button" onClick={onTryHigher}>Try higher difficulty</button>
        )}
      </section>
    </div>
  );
}
