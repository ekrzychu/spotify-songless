import type { Difficulty } from "@/types/game";

export const DIFFICULTY_THRESHOLDS = {
  easy: 1_000_000_000,
  normal: 250_000_000,
  hard: 50_000_000,
  extreme: 10_000_000,
} as const;

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
  extreme: "Extreme",
  impossible: "Impossible",
};

export function difficultyFromStreams(streams: number): Difficulty {
  if (!Number.isSafeInteger(streams) || streams < 0) {
    throw new RangeError("Stream count must be a non-negative safe integer");
  }
  if (streams >= DIFFICULTY_THRESHOLDS.easy) return "easy";
  if (streams >= DIFFICULTY_THRESHOLDS.normal) return "normal";
  if (streams >= DIFFICULTY_THRESHOLDS.hard) return "hard";
  if (streams >= DIFFICULTY_THRESHOLDS.extreme) return "extreme";
  return "impossible";
}
