import { SNIPPET_LENGTHS } from "@/lib/game/snippets";

const TIMELINE_MS = 15_000;

export function timelineProgress(progressMs: number): number {
  return Math.min(Math.max(progressMs, 0) / TIMELINE_MS, 1);
}

export function DurationBar({ attempt, progressMs }: { attempt: number; progressMs: number }) {
  const previous = [0, ...SNIPPET_LENGTHS.slice(0, -1)];
  const currentLength = SNIPPET_LENGTHS[attempt]!;
  const label = currentLength === 1 ? "1 second" : `${currentLength} seconds`;
  return (
    <div className="playback-timeline" aria-label={`${label} unlocked`}>
      <div
        className={`playback-timeline-label${attempt === 0 ? " is-start" : attempt === SNIPPET_LENGTHS.length - 1 ? " is-end" : ""}`}
        style={{ left: `${(currentLength / 15) * 100}%` }}
      >{label}</div>
      <div className="duration-track" role="progressbar" aria-label="Snippet playback" aria-valuemin={0} aria-valuemax={TIMELINE_MS} aria-valuenow={Math.round(progressMs)}>
        {SNIPPET_LENGTHS.map((length, index) => {
          const width = ((length - (previous[index] ?? 0)) / 15) * 100;
          return (
            <span
              className={`duration-segment${index <= attempt ? " is-unlocked" : ""}`}
              style={{ width: `${width}%` }}
              key={length}
            />
          );
        })}
        <span className="duration-fill" style={{ transform: `scaleX(${timelineProgress(progressMs)})` }} />
      </div>
      <div className="duration-scale"><span>0</span><span>15s</span></div>
    </div>
  );
}
