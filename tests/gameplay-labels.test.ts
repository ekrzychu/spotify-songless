import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { timelineProgress } from "@/components/game/duration-bar";
import { stageStateForAttempt } from "@/components/game/stage-progress";
import { attemptActionLabel } from "@/components/game/guess-search";
import { PLAY_ICON_PATH } from "@/components/game/play-button";

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

  it("derives completed, current, and future stage presentation from the attempt", () => {
    expect(Array.from({ length: 6 }, (_, index) => stageStateForAttempt(index, 2))).toEqual([
      "completed", "completed", "current", "future", "future", "future",
    ]);
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

  it("centers the play glyph without a CSS translation workaround", () => {
    expect(PLAY_ICON_PATH).toBe("M7 5 16 10 7 15Z");
    const vertices: ReadonlyArray<readonly [number, number]> = [[7, 5], [16, 10], [7, 15]];
    expect(vertices.reduce((sum, [x]) => sum + x, 0) / vertices.length).toBe(10);
    expect(vertices.reduce((sum, [, y]) => sum + y, 0) / vertices.length).toBe(10);

    const styles = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(styles).not.toMatch(/\.play-button:not\(\.is-playing\)[^{]*\{[^}]*translateX/);
  });
});
