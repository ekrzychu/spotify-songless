import { describe, expect, it } from "vitest";
import { isCorrectGuess } from "@/lib/game/correctness";

describe("isCorrectGuess", () => {
  it("matches the same Spotify track", () => {
    expect(isCorrectGuess({ spotifyTrackId: "a", isrc: null }, { spotifyTrackId: "a", isrc: null })).toBe(true);
  });

  it("matches alternate releases of the same ISRC", () => {
    expect(isCorrectGuess(
      { spotifyTrackId: "remaster", isrc: "US-ABC-12-34567" },
      { spotifyTrackId: "original", isrc: "USABC1234567" },
    )).toBe(true);
  });

  it("rejects a different recording", () => {
    expect(isCorrectGuess(
      { spotifyTrackId: "one", isrc: "USABC1234567" },
      { spotifyTrackId: "two", isrc: "GBXYZ7654321" },
    )).toBe(false);
  });
});
