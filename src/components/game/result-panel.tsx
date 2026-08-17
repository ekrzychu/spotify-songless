import type { AnswerView } from "@/types/game";

export function ResultPanel({ won, attempts, answer, onNext }: {
  won: boolean; attempts: number; answer: AnswerView; onNext: () => void;
}) {
  return (
    <div className="result-backdrop" role="presentation">
      <section className="result-panel" role="dialog" aria-modal="true" aria-labelledby="result-title">
        <span className={`result-status${won ? " is-win" : ""}`} aria-hidden="true">{won ? "✓" : "—"}</span>
        <p className="result-eyebrow">{won ? "You got it" : "Better luck next time"}</p>
        <h2 id="result-title">{answer.title}</h2>
        <p className="result-artist">{answer.artistNames}</p>
        {won && <p className="result-solved">Solved in {attempts} / 6</p>}
        <dl className="result-meta">
          <div><dt>Album</dt><dd>{answer.albumName}</dd></div>
          <div><dt>Streams</dt><dd>{answer.streamCount ? Number(answer.streamCount).toLocaleString() : "Unranked"}</dd></div>
        </dl>
        <a className="spotify-link" href={answer.spotifyUrl} target="_blank" rel="noreferrer">Open in Spotify <span aria-hidden="true">↗</span></a>
        <button className="next-button" type="button" onClick={onNext}>Next Song</button>
      </section>
    </div>
  );
}
