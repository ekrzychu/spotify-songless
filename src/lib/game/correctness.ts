import type { TrackIdentity } from "@/types/game";

const normalizeIsrc = (value: string | null) => value?.replace(/[^a-z0-9]/gi, "").toUpperCase() || null;

export function isCorrectGuess(guess: TrackIdentity, answer: TrackIdentity): boolean {
  if (guess.spotifyTrackId === answer.spotifyTrackId) return true;
  const guessIsrc = normalizeIsrc(guess.isrc);
  const answerIsrc = normalizeIsrc(answer.isrc);
  return Boolean(guessIsrc && answerIsrc && guessIsrc === answerIsrc);
}
