export const PLAY_ICON_PATH = "M7 5 16 10 7 15Z";

export function PlayButton({ playing, disabled, onClick }: { playing: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button className={`play-button${playing ? " is-playing" : ""}`} type="button" disabled={disabled} onClick={onClick} aria-label={playing ? "Pause song snippet" : "Play song snippet"}>
      {playing
        ? <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.75 5.5h2.4v9h-2.4zm4.1 0h2.4v9h-2.4z" /></svg>
        : <svg viewBox="0 0 20 20" aria-hidden="true"><path d={PLAY_ICON_PATH} /></svg>}
    </button>
  );
}
