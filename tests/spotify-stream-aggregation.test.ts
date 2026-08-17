import { describe, expect, it } from "vitest";
import {
  aggregateSpotifyStreams,
  summarizeSpotifyStreams,
} from "@/lib/streams/spotify-stream-aggregation";

const plots = (...values: unknown[]) => values.map((value, index) => ({
  identifier: `spotify-${index}`,
  value,
}));

describe("Spotify stream aggregation", () => {
  it("sums unique cumulative values across Spotify identifiers", () => {
    expect(aggregateSpotifyStreams(plots(5_400_000, 600_000, 600_000))).toBe(6_000_000);
  });

  it.each([
    [[1_000], 1_000],
    [[1_000, 1_000], 1_000],
    [[], null],
  ] as const)("aggregates %j", (values, expected) => {
    expect(aggregateSpotifyStreams(plots(...values))).toBe(expected);
  });

  it("ignores malformed, negative, fractional, and unsafe values", () => {
    const result = summarizeSpotifyStreams([
      { identifier: "valid", value: 10 },
      { identifier: "negative", value: -1 },
      { identifier: "fractional", value: 1.5 },
      { identifier: "unsafe", value: Number.MAX_SAFE_INTEGER + 1 },
      { identifier: "string", value: "100" },
      null,
    ]);
    expect(result).toEqual({ streamCount: 10, identifierCount: 5, uniqueValueCount: 1 });
  });

  it("returns null when no valid values remain", () => {
    expect(aggregateSpotifyStreams([{ identifier: "spotify", value: -1 }])).toBeNull();
  });

  it("throws instead of overflowing the safe integer range", () => {
    expect(() => aggregateSpotifyStreams(plots(Number.MAX_SAFE_INTEGER, 1))).toThrow(RangeError);
  });
});
