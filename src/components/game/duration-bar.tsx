import { SNIPPET_LENGTHS } from "@/lib/game/snippets";

const TIMELINE_MS = 15_000;

export function timelineProgress(progressMs: number): number {
  return Math.min(Math.max(progressMs, 0) / TIMELINE_MS, 1);
}

export function stageStateForAttempt(
  stageIndex: number,
  attempt: number,
): "completed" | "current" | "future" {
  if (stageIndex < attempt) return "completed";
  if (stageIndex === attempt) return "current";
  return "future";
}

export function DurationBar({ attempt, progressMs }: { attempt: number; progressMs: number }) {
  const currentLength = SNIPPET_LENGTHS[attempt]!;
  const label = currentLength === 1 ? "1 second" : `${currentLength} seconds`;
  return (
    <div className="duration" aria-label={`${label} unlocked`}>
      <ol className="stage-list" aria-label="Snippet stages">
        {SNIPPET_LENGTHS.map((length, index) => {
          const state = stageStateForAttempt(index, attempt);
          return (
            <li
              className={`stage-marker stage-marker--${state}`}
              aria-current={state === "current" ? "step" : undefined}
              key={length}
            >
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <strong>{length}s</strong>
            </li>
          );
        })}
      </ol>
      <div className="duration-track" role="progressbar" aria-label="Snippet playback" aria-valuemin={0} aria-valuemax={TIMELINE_MS} aria-valuenow={Math.round(progressMs)}>
        <span className="duration-fill" style={{ transform: `scaleX(${timelineProgress(progressMs)})` }} />
      </div>
      <div className="duration-caption"><span>Playback</span><span>{currentLength}s / 15s</span></div>
    </div>
  );
}
