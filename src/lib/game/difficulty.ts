import type { GameDifficulty, RankedDifficulty } from "@/types/game";

export const DIFFICULTY_THRESHOLDS = {
  easy: 1_000_000_000,
  normal: 250_000_000,
  hard: 50_000_000,
  extreme: 10_000_000,
} as const;

export const RANKED_DIFFICULTY_LABELS: Record<RankedDifficulty, string> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
  extreme: "Extreme",
  impossible: "Impossible",
};

export const GAME_DIFFICULTY_LABELS: Record<GameDifficulty, string> = {
  ...RANKED_DIFFICULTY_LABELS,
  unranked: "Unranked",
};

export function difficultyFromStreams(streams: number): RankedDifficulty {
  if (!Number.isSafeInteger(streams) || streams < 0) {
    throw new RangeError("Stream count must be a non-negative safe integer");
  }
  if (streams >= DIFFICULTY_THRESHOLDS.easy) return "easy";
  if (streams >= DIFFICULTY_THRESHOLDS.normal) return "normal";
  if (streams >= DIFFICULTY_THRESHOLDS.hard) return "hard";
  if (streams >= DIFFICULTY_THRESHOLDS.extreme) return "extreme";
  return "impossible";
}
