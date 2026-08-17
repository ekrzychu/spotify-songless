import { describe, expect, it } from "vitest";
import { timelineProgress } from "@/components/game/duration-bar";
import { attemptActionLabel } from "@/components/game/guess-search";

describe("gameplay labels and progress", () => {
  it.each([
    [100, 0.1 / 15],
    [1_000, 1 / 15],
    [2_000, 2 / 15],
    [5_000, 5 / 15],
    [10_000, 10 / 15],
    [15_000, 1],
  ])("maps %dms onto the fixed 15-second timeline", (progressMs, expected) => {
    expect(timelineProgress(progressMs)).toBeCloseTo(expected);
  });

  it("says Skip for each of the first five attempts", () => {
    for (const attempt of [1, 2, 3, 4, 5]) {
      expect(attemptActionLabel(false, attempt === 6)).toBe("Skip");
    }
  });

  it("says Give up only when the final attempt has no selection", () => {
    expect(attemptActionLabel(false, true)).toBe("Give up");
    expect(attemptActionLabel(true, true)).toBe("Submit");
  });
});
