import { describe, expect, it } from "vitest";
import { resolveDatasetFile } from "@/lib/streams/data-file";
import {
  SpotifyFullImportAccumulator,
  formatSpotifyFullImportReport,
  updatesToApply,
  type SpotifyFullImportTrack,
} from "@/lib/streams/spotify-full-import";
import {
  canSoundchartsReplace,
  canSpotifyFullReplace,
  canVerifiedCsvReplace,
  isVerifiedStreamSource,
} from "@/lib/streams/stream-sources";

const ID = "1234567890123456789012";

function track(overrides: Partial<SpotifyFullImportTrack> = {}): SpotifyFullImportTrack {
  return {
    id: "local-1",
    spotifyTrackId: ID,
    streamCount: null,
    streamCountSource: null,
    difficulty: null,
    ...overrides,
  };
}

function plan(local: SpotifyFullImportTrack, rows: Array<Record<string, string>>) {
  const accumulator = new SpotifyFullImportAccumulator(new Map([[local.spotifyTrackId, local]]));
  rows.forEach((row) => accumulator.consume(row));
  return accumulator.plan();
}

describe("spotify_full provisional import", () => {
  it("matches exact Spotify IDs and rounds decimal estimated values", () => {
    const result = plan(track(), [{
      spotify_id: ID,
      streams_total: "250000000.49",
      streams_source: "arc2_2023_top",
      streams_total_estimated: "True",
    }]);
    expect(result.updates).toEqual([expect.objectContaining({
      spotifyTrackId: ID, streamCount: 250_000_000, difficulty: "easy",
    })]);
    expect(result.diagnostics).toMatchObject({ estimatedTrue: 1, arc2_2023Top: 1 });
  });

  it.each(["arc7_chart_dump", "arc2_2023_top"])("accepts %s rows provisionally", (source) => {
    const result = plan(track(), [{
      spotify_id: ID, streams_total: "50000000.2", streams_source: source,
      streams_total_estimated: "false",
    }]);
    expect(result.updates[0]).toMatchObject({ streamCount: 50_000_000, difficulty: "easy" });
  });

  it("rejects malformed IDs and invalid stream counts", () => {
    const result = plan(track(), [
      { spotify_id: "short", streams_total: "100" },
      { spotify_id: ID, streams_total: "-1" },
    ]);
    expect(result).toMatchObject({ invalidSpotifyIdRows: 1, invalidMatchedRows: 1, updated: 0 });
  });

  it("deterministically keeps the highest valid duplicate value", () => {
    const result = plan(track(), [
      { spotify_id: ID, streams_total: "50000000" },
      { spotify_id: ID, streams_total: "1000000000.1" },
      { spotify_id: ID, streams_total: "250000000" },
    ]);
    expect(result).toMatchObject({ uniqueMatchedTracks: 1, duplicateMatchedRows: 2 });
    expect(result.updates[0]).toMatchObject({ streamCount: 1_000_000_000, difficulty: "easy" });
  });

  it.each([null, "spotify_full"])("allows provisional updates over %s", (source) => {
    expect(plan(track({ streamCountSource: source }), [{ spotify_id: ID, streams_total: "10" }]).updated).toBe(1);
  });

  it("reclassifies an unchanged raw spotify_full stream count on reimport", () => {
    const result = plan(track({
      streamCount: 3_000_000n,
      streamCountSource: "spotify_full",
      difficulty: "impossible",
    }), [{ spotify_id: ID, streams_total: "3000000" }]);
    expect(result.updates).toEqual([expect.objectContaining({
      streamCount: 3_000_000,
      difficulty: "normal",
    })]);
  });

  it.each(["soundcharts", "csv", "future_verified"])("protects verified source %s", (source) => {
    const result = plan(track({ streamCountSource: source }), [{ spotify_id: ID, streams_total: "10" }]);
    expect(result.updated).toBe(0);
  });

  it("reports provisional calibration and makes dry-run plans non-writable", () => {
    const result = plan(track(), [{ spotify_id: ID, streams_total: "3000000" }]);
    expect(updatesToApply(result, true)).toEqual([]);
    expect(updatesToApply(result, false)).toEqual(result.updates);
    const report = formatSpotifyFullImportReport(result, "data/spotify_full.csv", { dryRun: true });
    expect(report).toContain("Mode: DRY RUN");
    expect(report).toContain("Calibration: global median provisional");
    expect(report).toContain("Easy >= 5,555,777");
  });
});

describe("stream source precedence", () => {
  it("encodes provisional and verified replacement rules centrally", () => {
    expect(canSpotifyFullReplace(null)).toBe(true);
    expect(canSpotifyFullReplace("spotify_full")).toBe(true);
    expect(canSpotifyFullReplace("soundcharts")).toBe(false);
    expect(canVerifiedCsvReplace("spotify_full")).toBe(true);
    expect(canVerifiedCsvReplace("csv")).toBe(true);
    expect(canVerifiedCsvReplace("soundcharts")).toBe(false);
    expect(canVerifiedCsvReplace("future_verified")).toBe(false);
    expect(canSoundchartsReplace("spotify_full")).toBe(true);
    expect(canSoundchartsReplace("soundcharts", false)).toBe(false);
    expect(canSoundchartsReplace("soundcharts", true)).toBe(true);
    expect(isVerifiedStreamSource("future_verified")).toBe(true);
  });
});

describe("dataset file resolution", () => {
  it("resolves a filename directly under data", async () => {
    await expect(resolveDatasetFile("spotify_full.csv", {
      repositoryRoot: "C:\\repo",
      fileExists: async () => true,
    })).resolves.toMatchObject({ displayPath: "data/spotify_full.csv", fileName: "spotify_full.csv" });
  });

  it.each([
    "C:\\data\\spotify_full.csv", "C:spotify_full.csv", "/data/spotify_full.csv", "../spotify_full.csv",
    "..\\spotify_full.csv", "nested/spotify_full.csv", "nested\\spotify_full.csv",
  ])("rejects paths outside the direct data directory: %s", async (value) => {
    await expect(resolveDatasetFile(value, { fileExists: async () => true })).rejects.toThrow("file name");
  });

  it("prints an actionable missing-file message", async () => {
    await expect(resolveDatasetFile("missing.csv", { fileExists: async () => false })).rejects.toThrow(
      "File not found: data/missing.csv\nPlace the CSV file in the repository's data/ directory and try again.",
    );
  });
});
