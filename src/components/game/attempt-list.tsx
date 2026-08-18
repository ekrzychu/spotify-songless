import { MAX_ATTEMPTS } from "@/lib/game/snippets";
import type { AttemptView } from "@/types/game";

export function AttemptList({ attempts, currentAttempt, finished }: {
  attempts: AttemptView[]; currentAttempt: number; finished: boolean;
}) {
  return (
    <section className="attempt-history" aria-labelledby="attempt-heading">
      <div className="attempt-history-heading">
        <h2 className="rail-heading" id="attempt-heading">Guesses</h2>
        <span>{attempts.length} / {MAX_ATTEMPTS}</span>
      </div>
      <ol className="attempt-list" aria-label="Guesses">
        {Array.from({ length: MAX_ATTEMPTS }, (_, index) => {
          const attempt = attempts.find((item) => item.number === index + 1);
          const state = attempt?.outcome ?? (!finished && index === currentAttempt ? "current" : "empty");
          return (
            <li className={`attempt attempt--${state}`} key={index} aria-current={state === "current" ? "step" : undefined}>
              <span className="attempt-mark" aria-hidden="true">
                {state === "correct" ? "✓" : state === "incorrect" ? "×" : state === "skipped" ? "—" : index + 1}
              </span>
              <span>{attempt?.label ?? (state === "current" ? `Attempt ${index + 1}` : "Unused")}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
