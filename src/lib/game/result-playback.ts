import type { RoundView } from "@/types/game";

export const RESULT_REVEAL_DURATION_SECONDS = 15;

export function shouldStartResultPlayback(
  previousRound: RoundView | null,
  nextRound: RoundView,
  startedRoundId: string | null,
): boolean {
  return Boolean(
    previousRound
    && previousRound.id === nextRound.id
    && !previousRound.finished
    && nextRound.finished
    && startedRoundId !== nextRound.id,
  );
}
