import { SNIPPET_LENGTHS } from "@/lib/game/snippets";

export function DurationBar({ attempt, progress }: { attempt: number; progress: number }) {
  const previous = [0, ...SNIPPET_LENGTHS.slice(0, -1)];
  const currentLength = SNIPPET_LENGTHS[attempt]!;
  const label = currentLength === 1 ? "1 second" : `${currentLength} seconds`;
  return (
    <div className="duration" aria-label={`${label} unlocked`}>
      <div
        className={`duration-label${attempt === 0 ? " is-start" : attempt === SNIPPET_LENGTHS.length - 1 ? " is-end" : ""}`}
        style={{ left: `${(currentLength / 15) * 100}%` }}
      >{label}</div>
      <div className="duration-track">
        {SNIPPET_LENGTHS.map((length, index) => {
          const width = ((length - (previous[index] ?? 0)) / 15) * 100;
          const unlocked = index <= attempt;
          const fill = index < attempt ? 1 : index === attempt ? progress : 0;
          return (
            <span className={`duration-segment${unlocked ? " is-unlocked" : ""}`} style={{ width: `${width}%` }} key={length}>
              <span style={{ transform: `scaleX(${fill})` }} />
            </span>
          );
        })}
      </div>
      <div className="duration-scale"><span>0</span><span>15s</span></div>
    </div>
  );
}
