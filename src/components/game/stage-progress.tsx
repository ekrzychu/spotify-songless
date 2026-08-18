import { SNIPPET_LENGTHS } from "@/lib/game/snippets";

export function stageStateForAttempt(
  stageIndex: number,
  attempt: number,
): "completed" | "current" | "future" {
  if (stageIndex < attempt) return "completed";
  if (stageIndex === attempt) return "current";
  return "future";
}

export function StageProgress({ attempt }: { attempt: number }) {
  return (
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
  );
}
