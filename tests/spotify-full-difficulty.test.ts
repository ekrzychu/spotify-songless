import { describe, expect, it } from "vitest";
import { DIFFICULTY_THRESHOLDS, difficultyFromStreams } from "@/lib/game/difficulty";
import {
  SPOTIFY_FULL_PROVISIONAL_THRESHOLDS,
  difficultyFromSpotifyFullStreams,
} from "@/lib/streams/spotify-full-difficulty";

describe("spotify_full provisional difficulty", () => {
  it.each([
    [5_555_777, "easy"],
    [5_555_776, "normal"],
    [1_388_944, "normal"],
    [1_388_943, "hard"],
    [277_789, "hard"],
    [277_788, "extreme"],
    [55_558, "extreme"],
    [55_557, "impossible"],
    [0, "impossible"],
  ] as const)("classifies %i as %s", (streams, difficulty) => {
    expect(difficultyFromSpotifyFullStreams(streams)).toBe(difficulty);
  });

  it("rejects negative and unsafe values", () => {
    expect(() => difficultyFromSpotifyFullStreams(-1)).toThrow(RangeError);
    expect(() => difficultyFromSpotifyFullStreams(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it("does not change canonical verified thresholds or their classifier", () => {
    expect(SPOTIFY_FULL_PROVISIONAL_THRESHOLDS).toEqual({
      easy: 5_555_777, normal: 1_388_944, hard: 277_789, extreme: 55_558,
    });
    expect(DIFFICULTY_THRESHOLDS).toEqual({
      easy: 1_000_000_000, normal: 250_000_000, hard: 50_000_000, extreme: 10_000_000,
    });
    expect(difficultyFromStreams(50_000_000)).toBe("hard");
    expect(difficultyFromSpotifyFullStreams(50_000_000)).toBe("easy");
  });
});
