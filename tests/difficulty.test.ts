import { describe, expect, it } from "vitest";
import { difficultyFromStreams } from "@/lib/game/difficulty";

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
});
