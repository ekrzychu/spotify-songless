import { describe, expect, it } from "vitest";
import { normalizeStreamRows } from "@/lib/streams/import-normalizer";

const ID = "0123456789012345678901";
const OTHER_ID = "ABCDEFGHIJKLmnopqrstuv";

describe("stream CSV normalization", () => {
  it("trims valid values and normalizes ISRC", () => {
    const result = normalizeStreamRows([{ spotify_track_id: ` ${ID} `, isrc: " US-ABC-12-34567 ", stream_count: " 250000000 " }]);
    expect(result.rows[0]).toMatchObject({ spotifyTrackId: ID, isrc: "USABC1234567", streamCount: 250_000_000 });
  });

  it.each([
    { spotify_track_id: "bad", isrc: "", stream_count: "10" },
    { spotify_track_id: "", isrc: "", stream_count: "10" },
    { spotify_track_id: ID, isrc: "", stream_count: "-1" },
    { spotify_track_id: ID, isrc: "", stream_count: "1.5" },
    { spotify_track_id: ID, isrc: "", stream_count: "9007199254740992" },
  ])("rejects malformed input", (row) => {
    expect(normalizeStreamRows([row])).toMatchObject({ rows: [], invalid: 1 });
  });

  it("deduplicates identical rows", () => {
    const row = { spotify_track_id: ID, isrc: "USABC1234567", stream_count: "10" };
    expect(normalizeStreamRows([row, row]).rows).toHaveLength(1);
  });

  it("rejects every row involved in a conflicting Spotify ID", () => {
    const result = normalizeStreamRows([
      { spotify_track_id: ID, isrc: "USABC1234567", stream_count: "10" },
      { spotify_track_id: ID, isrc: "USABC1234567", stream_count: "20" },
    ]);
    expect(result).toMatchObject({ rows: [], conflicts: 2 });
  });

  it("rejects conflicts across duplicate normalized ISRCs", () => {
    const result = normalizeStreamRows([
      { spotify_track_id: ID, isrc: "US-ABC-12-34567", stream_count: "10" },
      { spotify_track_id: OTHER_ID, isrc: "USABC1234567", stream_count: "20" },
    ]);
    expect(result).toMatchObject({ rows: [], conflicts: 2 });
  });
});
