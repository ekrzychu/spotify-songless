import { describe, expect, it } from "vitest";
import { difficultyFromStreams, nextHigherDifficulty } from "@/lib/game/difficulty";
import { GAME_DIFFICULTIES, RANKED_DIFFICULTIES } from "@/types/game";

describe("difficultyFromStreams", () => {
  it.each([
    [999_999_999, "normal"], [1_000_000_000, "easy"],
    [249_999_999, "hard"], [250_000_000, "normal"],
    [49_999_999, "extreme"], [50_000_000, "hard"],
    [9_999_999, "impossible"], [10_000_000, "extreme"],
  ] as const)("classifies %i as %s", (streams, expected) => {
    expect(difficultyFromStreams(streams)).toBe(expected);
  });

  it("rejects fabricated or invalid numeric values", () => {
    expect(() => difficultyFromStreams(-1)).toThrow(RangeError);
    expect(() => difficultyFromStreams(1.5)).toThrow(RangeError);
  });

  it("keeps Soundcharts ranking separate from the gameplay-only Unranked mode", () => {
    expect(RANKED_DIFFICULTIES).toEqual(["easy", "normal", "hard", "extreme", "impossible"]);
    expect(GAME_DIFFICULTIES).toEqual([...RANKED_DIFFICULTIES, "unranked"]);
    expect([75_000_000, 1_000_000_000].map(difficultyFromStreams).every(
      (difficulty) => RANKED_DIFFICULTIES.includes(difficulty),
    )).toBe(true);
  });
});

describe("higher difficulty mapping", () => {
  it.each([
    ["easy", "normal"],
    ["normal", "hard"],
    ["hard", "extreme"],
    ["extreme", "impossible"],
    ["impossible", null],
    ["unranked", null],
  ] as const)("maps %s to %s", (current, expected) => {
    expect(nextHigherDifficulty(current)).toBe(expected);
  });
});
