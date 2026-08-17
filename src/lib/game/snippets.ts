export const SNIPPET_LENGTHS = [0.1, 1, 2, 5, 10, 15] as const;
export const MAX_ATTEMPTS = SNIPPET_LENGTHS.length;

export function snippetLengthForAttempt(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= MAX_ATTEMPTS) {
    throw new RangeError(`Attempt must be between 0 and ${MAX_ATTEMPTS - 1}`);
  }
  return SNIPPET_LENGTHS[attempt]!;
}

export type RoundMachine = { attempt: number; finished: boolean; won: boolean };

export function applyAttempt(state: RoundMachine, outcome: "skip" | "wrong" | "correct"): RoundMachine {
  if (state.finished) return state;
  if (outcome === "correct") return { ...state, finished: true, won: true };
  const nextAttempt = state.attempt + 1;
  return {
    attempt: Math.min(nextAttempt, MAX_ATTEMPTS - 1),
    finished: nextAttempt >= MAX_ATTEMPTS,
    won: false,
  };
}

export function replaySnippet(state: RoundMachine): RoundMachine {
  return state;
}
