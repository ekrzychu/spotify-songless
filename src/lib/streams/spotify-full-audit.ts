import { difficultyFromStreams } from "@/lib/game/difficulty";
import { RANKED_DIFFICULTIES, type RankedDifficulty } from "@/types/game";

export type LocalRankedTrack = {
  spotifyTrackId: string;
  streamCount: number;
  difficulty: RankedDifficulty;
  streamCountSource: string | null;
  title: string;
  artistNames: string;
};

export type SpotifyFullRow = {
  spotify_id?: string;
  streams_total?: string;
  streams_source?: string;
  streams_total_estimated?: string;
};

export type StreamComparison = {
  spotifyTrackId: string;
  title: string;
  artistNames: string;
  localStreams: number;
  csvStreams: number;
  localDifficulty: RankedDifficulty;
  csvDifficulty: RankedDifficulty;
  streamCountSource: string | null;
  streamsSource: string;
  estimated: boolean;
  ratio: number | null;
  absolutePercentageError: number | null;
  difficultyMatches: boolean;
};

export type AuditGroup = {
  matchedTracks: number;
  exactDifficultyMatches: number;
  exactDifficultyMatchPercent: number | null;
  medianRatio: number | null;
  meanRatio: number | null;
  medianAbsolutePercentageError: number | null;
};

export type SpotifyFullAudit = {
  rowsRead: number;
  matchedRows: number;
  invalidMatchedRows: number;
  duplicateMatchedRows: number;
  comparisons: StreamComparison[];
  groups: {
    all: AuditGroup;
    estimatedTrue: AuditGroup;
    estimatedFalse: AuditGroup;
    arc7ChartDump: AuditGroup;
    arc2_2023Top: AuditGroup;
  };
  confusionMatrix: Record<RankedDifficulty, Record<RankedDifficulty, number>>;
};

const DECIMAL_STREAM_COUNT = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

export function parseSpotifyFullStreams(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || !DECIMAL_STREAM_COUNT.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const rounded = Math.round(parsed);
  // A stream count is integral. Accept serialization artifacts such as "1316855716.0",
  // but do not silently convert a materially fractional value into a count.
  if (!Number.isSafeInteger(rounded) || Math.abs(parsed - rounded) > 0.000_001) return null;
  return rounded;
}

export function isRankedDifficulty(value: string): value is RankedDifficulty {
  return (RANKED_DIFFICULTIES as readonly string[]).includes(value);
}

function parseEstimated(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes((value ?? "").trim().toLowerCase());
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function summarize(comparisons: readonly StreamComparison[]): AuditGroup {
  const ratios = comparisons.flatMap((comparison) => comparison.ratio === null ? [] : [comparison.ratio]);
  const errors = comparisons.flatMap((comparison) => (
    comparison.absolutePercentageError === null ? [] : [comparison.absolutePercentageError]
  ));
  const exactDifficultyMatches = comparisons.filter((comparison) => comparison.difficultyMatches).length;
  return {
    matchedTracks: comparisons.length,
    exactDifficultyMatches,
    exactDifficultyMatchPercent: comparisons.length
      ? (exactDifficultyMatches / comparisons.length) * 100
      : null,
    medianRatio: median(ratios),
    meanRatio: ratios.length ? ratios.reduce((total, value) => total + value, 0) / ratios.length : null,
    medianAbsolutePercentageError: median(errors),
  };
}

function emptyConfusionMatrix(): SpotifyFullAudit["confusionMatrix"] {
  return Object.fromEntries(RANKED_DIFFICULTIES.map((localDifficulty) => [
    localDifficulty,
    Object.fromEntries(RANKED_DIFFICULTIES.map((csvDifficulty) => [csvDifficulty, 0])),
  ])) as SpotifyFullAudit["confusionMatrix"];
}

export class SpotifyFullAuditAccumulator {
  private readonly comparisonsBySpotifyId = new Map<string, StreamComparison>();
  private rowsRead = 0;
  private matchedRows = 0;
  private invalidMatchedRows = 0;
  private duplicateMatchedRows = 0;

  constructor(private readonly localTracksBySpotifyId: ReadonlyMap<string, LocalRankedTrack>) {}

  consume(row: SpotifyFullRow): void {
    this.rowsRead += 1;
    const spotifyTrackId = row.spotify_id?.trim();
    if (!spotifyTrackId) return;
    const local = this.localTracksBySpotifyId.get(spotifyTrackId);
    if (!local) return;

    const csvStreams = parseSpotifyFullStreams(row.streams_total);
    if (csvStreams === null) {
      this.invalidMatchedRows += 1;
      return;
    }
    if (this.comparisonsBySpotifyId.has(spotifyTrackId)) {
      this.duplicateMatchedRows += 1;
      return;
    }

    this.matchedRows += 1;
    const csvDifficulty = difficultyFromStreams(csvStreams);
    const ratio = local.streamCount === 0 ? null : csvStreams / local.streamCount;
    const absolutePercentageError = ratio === null ? null : Math.abs(ratio - 1) * 100;
    this.comparisonsBySpotifyId.set(spotifyTrackId, {
      spotifyTrackId,
      title: local.title,
      artistNames: local.artistNames,
      localStreams: local.streamCount,
      csvStreams,
      localDifficulty: local.difficulty,
      csvDifficulty,
      streamCountSource: local.streamCountSource,
      streamsSource: row.streams_source?.trim() || "(blank)",
      estimated: parseEstimated(row.streams_total_estimated),
      ratio,
      absolutePercentageError,
      difficultyMatches: local.difficulty === csvDifficulty,
    });
  }

  report(): SpotifyFullAudit {
    const comparisons = [...this.comparisonsBySpotifyId.values()];
    const confusionMatrix = emptyConfusionMatrix();
    for (const comparison of comparisons) {
      confusionMatrix[comparison.localDifficulty][comparison.csvDifficulty] += 1;
    }
    return {
      rowsRead: this.rowsRead,
      matchedRows: this.matchedRows,
      invalidMatchedRows: this.invalidMatchedRows,
      duplicateMatchedRows: this.duplicateMatchedRows,
      comparisons,
      groups: {
        all: summarize(comparisons),
        estimatedTrue: summarize(comparisons.filter((comparison) => comparison.estimated)),
        estimatedFalse: summarize(comparisons.filter((comparison) => !comparison.estimated)),
        arc7ChartDump: summarize(comparisons.filter((comparison) => comparison.streamsSource === "arc7_chart_dump")),
        arc2_2023Top: summarize(comparisons.filter((comparison) => comparison.streamsSource === "arc2_2023_top")),
      },
      confusionMatrix,
    };
  }
}

function formatNumber(value: number | null, digits = 2): string {
  return value === null ? "N/A" : value.toFixed(digits);
}

function formatGroup(name: string, group: AuditGroup): string[] {
  return [
    name,
    `  Matched tracks: ${group.matchedTracks}`,
    `  Exact difficulty matches: ${group.exactDifficultyMatches}`,
    `  Exact difficulty match %: ${formatNumber(group.exactDifficultyMatchPercent)}%`,
    `  Median CSV/local ratio: ${formatNumber(group.medianRatio, 4)}`,
    `  Mean CSV/local ratio: ${formatNumber(group.meanRatio, 4)}`,
    `  Median absolute percentage error: ${formatNumber(group.medianAbsolutePercentageError)}%`,
  ];
}

function formatConfusionMatrix(matrix: SpotifyFullAudit["confusionMatrix"]): string[] {
  const labels = RANKED_DIFFICULTIES.map((difficulty) => difficulty[0]!.toUpperCase() + difficulty.slice(1));
  const width = 12;
  const pad = (value: string) => value.padEnd(width);
  return [
    "Difficulty confusion matrix (rows: local, columns: CSV)",
    `${pad("Local / CSV")}${labels.map(pad).join("")}`,
    ...RANKED_DIFFICULTIES.map((localDifficulty) => (
      `${pad(localDifficulty[0]!.toUpperCase() + localDifficulty.slice(1))}${RANKED_DIFFICULTIES
        .map((csvDifficulty) => pad(String(matrix[localDifficulty][csvDifficulty])))
        .join("")}`
    )),
  ];
}

function formatComparison(comparison: StreamComparison): string {
  return [
    comparison.spotifyTrackId,
    `${comparison.title} — ${comparison.artistNames}`,
    `local=${comparison.localStreams.toLocaleString()}`,
    `csv=${comparison.csvStreams.toLocaleString()}`,
    `difficulty=${comparison.localDifficulty}/${comparison.csvDifficulty}`,
    `source=${comparison.streamsSource}`,
    `estimated=${comparison.estimated}`,
    `ratio=${formatNumber(comparison.ratio, 4)}`,
    `error=${formatNumber(comparison.absolutePercentageError)}%`,
  ].join(" | ");
}

export function formatSpotifyFullAudit(audit: SpotifyFullAudit): string {
  const worstDisagreements = [...audit.comparisons]
    .sort((left, right) => (
      (right.absolutePercentageError ?? -1) - (left.absolutePercentageError ?? -1)
      || (right.ratio ?? -1) - (left.ratio ?? -1)
      || left.spotifyTrackId.localeCompare(right.spotifyTrackId)
    ))
    .slice(0, 20);
  const estimatedMatches = audit.comparisons
    .filter((comparison) => comparison.estimated && comparison.difficultyMatches)
    .sort((left, right) => left.spotifyTrackId.localeCompare(right.spotifyTrackId))
    .slice(0, 20);

  return [
    "Spotify full stream-count audit (read-only)",
    `CSV rows read: ${audit.rowsRead}`,
    `Matched tracks: ${audit.matchedRows}`,
    `Invalid matched CSV rows: ${audit.invalidMatchedRows}`,
    `Duplicate matched CSV rows ignored: ${audit.duplicateMatchedRows}`,
    "",
    ...formatGroup("A. ALL MATCHED ROWS", audit.groups.all),
    "",
    ...formatGroup("B. estimated=True", audit.groups.estimatedTrue),
    "",
    ...formatGroup("C. estimated=False", audit.groups.estimatedFalse),
    "",
    ...formatGroup("D. streams_source=arc7_chart_dump", audit.groups.arc7ChartDump),
    "",
    ...formatGroup("E. streams_source=arc2_2023_top", audit.groups.arc2_2023Top),
    "",
    ...formatConfusionMatrix(audit.confusionMatrix),
    "",
    "Per-local-difficulty agreement",
    ...RANKED_DIFFICULTIES.map((difficulty) => {
      const row = audit.comparisons.filter((comparison) => comparison.localDifficulty === difficulty);
      const matches = row.filter((comparison) => comparison.difficultyMatches).length;
      const label = difficulty[0]!.toUpperCase() + difficulty.slice(1);
      return `${label}: ${matches}/${row.length} (${formatNumber(row.length ? (matches / row.length) * 100 : null)}%)`;
    }),
    "",
    "20 worst disagreements by absolute percentage error",
    ...(worstDisagreements.length ? worstDisagreements.map(formatComparison) : ["  None"]),
    "",
    "20 estimated=True examples with matching difficulty",
    ...(estimatedMatches.length ? estimatedMatches.map(formatComparison) : ["  None"]),
  ].join("\n");
}
