import { describe, expect, it } from "vitest";
import { RESULT_REVEAL_DURATION_SECONDS, shouldStartResultPlayback } from "@/lib/game/result-playback";
import type { RoundView } from "@/types/game";

const active: RoundView = {
  id: "round", spotifyUri: "spotify:track:0123456789012345678901", attempt: 5,
  snippetLength: 15, finished: false, won: false, attempts: [],
};
const finished: RoundView = {
  ...active, finished: true, won: true,
  attempts: [{ number: 1, outcome: "correct", label: "Song — Artist" }],
};

describe("result reveal playback", () => {
  it("uses an exact 15-second controller duration", () => {
    expect(RESULT_REVEAL_DURATION_SECONDS).toBe(15);
  });

  it.each(["correct guess", "Give Up", "final loss"])("starts once after %s finishes the active round", () => {
    expect(shouldStartResultPlayback(active, finished, null)).toBe(true);
    expect(shouldStartResultPlayback(active, finished, "round")).toBe(false);
  });

  it("does not start for an ordinary wrong guess", () => {
    expect(shouldStartResultPlayback(active, { ...active, attempt: 1 }, null)).toBe(false);
  });

  it("does not autoplay a restored finished round", () => {
    expect(shouldStartResultPlayback(null, finished, null)).toBe(false);
    expect(shouldStartResultPlayback(finished, finished, null)).toBe(false);
  });
});
