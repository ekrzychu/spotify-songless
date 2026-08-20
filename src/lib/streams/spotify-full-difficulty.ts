import type { RankedDifficulty } from "@/types/game";

/**
 * Calibrated mapping for the provisional spotify_full proxy dataset.
 *
 * spotify_full's raw streams_total remains stored verbatim on GameTrack. Its
 * values are not verified lifetime streams, so this mapping intentionally
 * differs from the canonical Soundcharts / verified-CSV thresholds.
 */
export const SPOTIFY_FULL_PROVISIONAL_THRESHOLDS = {
  easy: 5_555_777,
  normal: 1_388_944,
  hard: 277_789,
  extreme: 55_558,
} as const;

export function difficultyFromSpotifyFullStreams(streams: number): RankedDifficulty {
  if (!Number.isSafeInteger(streams) || streams < 0) {
    throw new RangeError("Stream count must be a non-negative safe integer");
  }
  if (streams >= SPOTIFY_FULL_PROVISIONAL_THRESHOLDS.easy) return "easy";
  if (streams >= SPOTIFY_FULL_PROVISIONAL_THRESHOLDS.normal) return "normal";
  if (streams >= SPOTIFY_FULL_PROVISIONAL_THRESHOLDS.hard) return "hard";
  if (streams >= SPOTIFY_FULL_PROVISIONAL_THRESHOLDS.extreme) return "extreme";
  return "impossible";
}
