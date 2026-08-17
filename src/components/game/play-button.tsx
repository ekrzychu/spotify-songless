export function PlayButton({ playing, disabled, onClick }: { playing: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button className="play-button" type="button" disabled={disabled} onClick={onClick} aria-label={playing ? "Pause song snippet" : "Play song snippet"}>
      {playing
        ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z" /></svg>
        : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" /></svg>}
    </button>
  );
}
