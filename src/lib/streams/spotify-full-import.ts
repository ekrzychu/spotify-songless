import { difficultyFromStreams } from "@/lib/game/difficulty";
import { parseSpotifyFullStreams } from "@/lib/streams/spotify-full-audit";
import { STREAM_SOURCES, canSpotifyFullReplace } from "@/lib/streams/stream-sources";
import { RANKED_DIFFICULTIES, type RankedDifficulty } from "@/types/game";

export type SpotifyFullImportTrack = {
  id: string;
  spotifyTrackId: string;
  streamCount: bigint | null;
  streamCountSource: string | null;
  difficulty: string | null;
};

export type SpotifyFullImportRow = {
  spotify_id?: string;
  streams_total?: string;
  streams_source?: string;
  streams_total_estimated?: string;
};

export type SpotifyFullProvisionalUpdate = {
  id: string;
  spotifyTrackId: string;
  streamCount: number;
  difficulty: RankedDifficulty;
};

export type SpotifyFullImportPlan = {
  csvRowsRead: number;
  localCatalogTracks: number;
  matchingCsvRows: number;
  uniqueMatchedTracks: number;
  duplicateMatchedRows: number;
  invalidSpotifyIdRows: number;
  invalidMatchedRows: number;
  eligibleForUpdate: number;
  updated: number;
  unchangedSpotifyFull: number;
  skippedSoundcharts: number;
  skippedCsv: number;
  skippedOtherVerified: number;
  difficultyAssigned: Record<RankedDifficulty, number>;
  diagnostics: {
    estimatedTrue: number;
    estimatedFalse: number;
    arc7ChartDump: number;
    arc2_2023Top: number;
    blankStreamsSource: number;
  };
  updates: SpotifyFullProvisionalUpdate[];
};

export function isSpotifyTrackId(value: string): boolean {
  return /^[A-Za-z0-9]{22}$/.test(value);
}

function isEstimated(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

function emptyDifficultyCounts(): Record<RankedDifficulty, number> {
  return Object.fromEntries(RANKED_DIFFICULTIES.map((difficulty) => [difficulty, 0])) as Record<RankedDifficulty, number>;
}

export class SpotifyFullImportAccumulator {
  private csvRowsRead = 0;
  private matchingCsvRows = 0;
  private duplicateMatchedRows = 0;
  private invalidSpotifyIdRows = 0;
  private invalidMatchedRows = 0;
  private readonly candidates = new Map<string, number>();
  private readonly diagnostics = {
    estimatedTrue: 0,
    estimatedFalse: 0,
    arc7ChartDump: 0,
    arc2_2023Top: 0,
    blankStreamsSource: 0,
  };

  constructor(private readonly localTracks: ReadonlyMap<string, SpotifyFullImportTrack>) {}

  consume(row: SpotifyFullImportRow): void {
    this.csvRowsRead += 1;
    const spotifyTrackId = row.spotify_id?.trim() ?? "";
    if (!isSpotifyTrackId(spotifyTrackId)) {
      this.invalidSpotifyIdRows += 1;
      return;
    }
    if (!this.localTracks.has(spotifyTrackId)) return;
    this.matchingCsvRows += 1;

    const streamCount = parseSpotifyFullStreams(row.streams_total);
    if (streamCount === null) {
      this.invalidMatchedRows += 1;
      return;
    }
    const previous = this.candidates.get(spotifyTrackId);
    if (previous !== undefined) this.duplicateMatchedRows += 1;
    if (previous === undefined || streamCount > previous) this.candidates.set(spotifyTrackId, streamCount);

    if (isEstimated(row.streams_total_estimated)) this.diagnostics.estimatedTrue += 1;
    else this.diagnostics.estimatedFalse += 1;
    const source = row.streams_source ?? "";
    if (source === "arc7_chart_dump") this.diagnostics.arc7ChartDump += 1;
    if (source === "arc2_2023_top") this.diagnostics.arc2_2023Top += 1;
    if (!source) this.diagnostics.blankStreamsSource += 1;
  }

  plan(): SpotifyFullImportPlan {
    const updates: SpotifyFullProvisionalUpdate[] = [];
    const difficultyAssigned = emptyDifficultyCounts();
    let eligibleForUpdate = 0;
    let unchangedSpotifyFull = 0;
    let skippedSoundcharts = 0;
    let skippedCsv = 0;
    let skippedOtherVerified = 0;

    for (const [spotifyTrackId, streamCount] of this.candidates) {
      const track = this.localTracks.get(spotifyTrackId)!;
      if (!canSpotifyFullReplace(track.streamCountSource)) {
        if (track.streamCountSource === STREAM_SOURCES.verifiedSoundcharts) skippedSoundcharts += 1;
        else if (track.streamCountSource === STREAM_SOURCES.verifiedCsv) skippedCsv += 1;
        else skippedOtherVerified += 1;
        continue;
      }
      eligibleForUpdate += 1;
      const difficulty = difficultyFromStreams(streamCount);
      if (
        track.streamCountSource === STREAM_SOURCES.provisionalSpotifyFull
        && track.streamCount === BigInt(streamCount)
        && track.difficulty === difficulty
      ) {
        unchangedSpotifyFull += 1;
        continue;
      }
      difficultyAssigned[difficulty] += 1;
      updates.push({ id: track.id, spotifyTrackId, streamCount, difficulty });
    }

    return {
      csvRowsRead: this.csvRowsRead,
      localCatalogTracks: this.localTracks.size,
      matchingCsvRows: this.matchingCsvRows,
      uniqueMatchedTracks: this.candidates.size,
      duplicateMatchedRows: this.duplicateMatchedRows,
      invalidSpotifyIdRows: this.invalidSpotifyIdRows,
      invalidMatchedRows: this.invalidMatchedRows,
      eligibleForUpdate,
      updated: updates.length,
      unchangedSpotifyFull,
      skippedSoundcharts,
      skippedCsv,
      skippedOtherVerified,
      difficultyAssigned,
      diagnostics: { ...this.diagnostics },
      updates,
    };
  }
}

export function formatSpotifyFullImportReport(plan: SpotifyFullImportPlan, displayPath: string): string {
  return [
    "SPOTIFY_FULL PROVISIONAL STREAM IMPORT",
    "",
    `Input: ${displayPath}`,
    "",
    `CSV rows read: ${plan.csvRowsRead}`,
    `Local catalog tracks: ${plan.localCatalogTracks}`,
    `CSV rows matching local Spotify IDs: ${plan.matchingCsvRows}`,
    `Unique matched local tracks: ${plan.uniqueMatchedTracks}`,
    `Duplicate matched rows: ${plan.duplicateMatchedRows}`,
    `Invalid Spotify ID rows: ${plan.invalidSpotifyIdRows}`,
    `Invalid matched rows: ${plan.invalidMatchedRows}`,
    "",
    `Eligible for provisional update: ${plan.eligibleForUpdate}`,
    `Updated: ${plan.updated}`,
    `Already spotify_full unchanged: ${plan.unchangedSpotifyFull}`,
    `Skipped verified Soundcharts: ${plan.skippedSoundcharts}`,
    `Skipped verified CSV: ${plan.skippedCsv}`,
    `Skipped other verified sources: ${plan.skippedOtherVerified}`,
    "",
    "Difficulty assigned:",
    ...RANKED_DIFFICULTIES.map((difficulty) => (
      `${difficulty[0]!.toUpperCase()}${difficulty.slice(1)}: ${plan.difficultyAssigned[difficulty]}`
    )),
    "",
    "Source diagnostics:",
    `estimated=True: ${plan.diagnostics.estimatedTrue}`,
    `estimated=False: ${plan.diagnostics.estimatedFalse}`,
    `arc7_chart_dump: ${plan.diagnostics.arc7ChartDump}`,
    `arc2_2023_top: ${plan.diagnostics.arc2_2023Top}`,
    `blank streams_source: ${plan.diagnostics.blankStreamsSource}`,
  ].join("\n");
}
