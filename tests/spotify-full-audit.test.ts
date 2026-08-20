import { describe, expect, it } from "vitest";
import {
  SpotifyFullAuditAccumulator,
  parseSpotifyFullStreams,
  type LocalRankedTrack,
} from "@/lib/streams/spotify-full-audit";

function localTrack(overrides: Partial<LocalRankedTrack> = {}): LocalRankedTrack {
  return {
    spotifyTrackId: "local-track",
    streamCount: 250_000_000,
    difficulty: "normal",
    streamCountSource: "soundcharts",
    title: "Local Song",
    artistNames: "Local Artist",
    ...overrides,
  };
}

function auditFor(...rows: Parameters<SpotifyFullAuditAccumulator["consume"]>[0][]) {
  const local = localTrack();
  const audit = new SpotifyFullAuditAccumulator(new Map([[local.spotifyTrackId, local]]));
  rows.forEach((row) => audit.consume(row));
  return audit.report();
}

describe("Spotify full stream audit", () => {
  it("rounds finite non-negative decimal stream counts for audit comparison", () => {
    expect(parseSpotifyFullStreams("1316855716.0")).toBe(1_316_855_716);
    expect(parseSpotifyFullStreams("168237697.07436818")).toBe(168_237_697);
    expect(parseSpotifyFullStreams("51404619.29870994")).toBe(51_404_619);
  });

  it.each(["", " ", "-1", "NaN", "Infinity"])("rejects invalid stream totals: %s", (value) => {
    expect(parseSpotifyFullStreams(value)).toBeNull();
  });

  it("compares the local difficulty with the difficulty derived from CSV streams", () => {
    const report = auditFor({
      spotify_id: "local-track",
      streams_total: "1000000000.0",
      streams_source: "arc7_chart_dump",
      streams_total_estimated: "false",
    });

    expect(report.comparisons[0]).toMatchObject({
      localDifficulty: "normal",
      csvDifficulty: "easy",
      difficultyMatches: false,
      ratio: 4,
      absolutePercentageError: 300,
    });
    expect(report.confusionMatrix.normal.easy).toBe(1);
  });

  it("uses provisional thresholds when auditing a spotify_full-owned row", () => {
    const local = localTrack({
      streamCount: 3_000_000,
      difficulty: "normal",
      streamCountSource: "spotify_full",
    });
    const audit = new SpotifyFullAuditAccumulator(new Map([[local.spotifyTrackId, local]]));
    audit.consume({ spotify_id: "local-track", streams_total: "3000000" });
    expect(audit.report().comparisons[0]).toMatchObject({
      csvDifficulty: "normal",
      difficultyMatches: true,
    });
  });

  it("separates source and estimated groups", () => {
    const report = auditFor(
      {
        spotify_id: "local-track",
        streams_total: "250000000.29870994",
        streams_source: "arc7_chart_dump",
        streams_total_estimated: "true",
      },
    );

    expect(report.groups.estimatedTrue).toMatchObject({ matchedTracks: 1, exactDifficultyMatches: 1 });
    expect(report.groups.estimatedFalse).toMatchObject({ matchedTracks: 0 });
    expect(report.groups.arc7ChartDump).toMatchObject({ matchedTracks: 1 });
    expect(report.groups.arc2_2023Top).toMatchObject({ matchedTracks: 0 });
    expect(report.estimatedTrueConfusionMatrix.normal.normal).toBe(1);
    expect(report.estimatedTrueRatioBands).toContainEqual({ label: "0.75–1.25", matchedTracks: 1 });
    expect(report.comparisons[0]).toMatchObject({
      csvStreams: 250_000_000,
      streamsSource: "arc7_chart_dump",
      streamsTotalEstimated: "true",
    });
  });

  it("reports invalid matched IDs separately from valid matched IDs", () => {
    const report = auditFor({ spotify_id: "local-track", streams_total: "not a number" });

    expect(report).toMatchObject({
      matchedIdsBeforeValidation: 1,
      validMatchedIds: 0,
      invalidMatchedIds: 1,
    });
  });

  it("keeps the first valid duplicate CSV row deterministically", () => {
    const report = auditFor(
      { spotify_id: "local-track", streams_total: "250000000", streams_source: "arc2_2023_top" },
      { spotify_id: "local-track", streams_total: "1000000000", streams_source: "arc7_chart_dump" },
    );

    expect(report).toMatchObject({
      matchedIdsBeforeValidation: 1,
      validMatchedIds: 1,
      invalidMatchedIds: 0,
    });
    expect(report.matchedRows).toBe(1);
    expect(report.duplicateMatchedRows).toBe(1);
    expect(report.comparisons[0]).toMatchObject({
      csvStreams: 250_000_000,
      streamsSource: "arc2_2023_top",
      difficultyMatches: true,
    });
  });
});
