import { describe, expect, it } from "vitest";
import { applyAttempt, replaySnippet, SNIPPET_LENGTHS, snippetLengthForAttempt } from "@/lib/game/snippets";

describe("snippet attempts", () => {
  it("uses the configured length for every attempt", () => {
    expect(SNIPPET_LENGTHS.map((_, index) => snippetLengthForAttempt(index))).toEqual([0.1, 1, 2, 5, 10, 15]);
  });

  it.each(["skip", "wrong"] as const)("%s increments exactly once", (outcome) => {
    expect(applyAttempt({ attempt: 1, finished: false, won: false }, outcome)).toEqual({ attempt: 2, finished: false, won: false });
  });

  it("replay consumes no attempt", () => {
    const state = { attempt: 3, finished: false, won: false };
    expect(replaySnippet(state)).toBe(state);
  });

  it("a correct guess ends the round immediately", () => {
    expect(applyAttempt({ attempt: 2, finished: false, won: false }, "correct")).toEqual({ attempt: 2, finished: true, won: true });
  });

  it("the sixth failure ends the round", () => {
    expect(applyAttempt({ attempt: 5, finished: false, won: false }, "wrong")).toEqual({ attempt: 5, finished: true, won: false });
  });
});
