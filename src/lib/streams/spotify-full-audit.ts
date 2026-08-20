import { difficultyFromStreams } from "@/lib/game/difficulty";
import { difficultyFromSpotifyFullStreams } from "@/lib/streams/spotify-full-difficulty";
import { STREAM_SOURCES } from "@/lib/streams/stream-sources";
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
  streamsTotalEstimated: string;
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
  matchedIdsBeforeValidation: number;
  validMatchedIds: number;
  invalidMatchedIds: number;
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
  estimatedTrueConfusionMatrix: Record<RankedDifficulty, Record<RankedDifficulty, number>>;
  estimatedTrueRatioBands: Array<{ label: string; matchedTracks: number }>;
};

export function parseSpotifyFullStreams(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const rounded = Math.round(parsed);
  if (!Number.isSafeInteger(rounded)) return null;
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

const ESTIMATED_RATIO_BANDS = [
  { label: "CSV/local < 0.25", matches: (ratio: number) => ratio < 0.25 },
  { label: "0.25–0.50", matches: (ratio: number) => ratio >= 0.25 && ratio < 0.5 },
  { label: "0.50–0.75", matches: (ratio: number) => ratio >= 0.5 && ratio < 0.75 },
  { label: "0.75–1.25", matches: (ratio: number) => ratio >= 0.75 && ratio <= 1.25 },
  { label: "1.25–2.00", matches: (ratio: number) => ratio > 1.25 && ratio <= 2 },
  { label: "> 2.00", matches: (ratio: number) => ratio > 2 },
] as const;

export class SpotifyFullAuditAccumulator {
  private readonly comparisonsBySpotifyId = new Map<string, StreamComparison>();
  private readonly matchedSpotifyIds = new Set<string>();
  private readonly invalidSpotifyIds = new Set<string>();
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
    this.matchedSpotifyIds.add(spotifyTrackId);

    const csvStreams = parseSpotifyFullStreams(row.streams_total);
    if (csvStreams === null) {
      this.invalidMatchedRows += 1;
      this.invalidSpotifyIds.add(spotifyTrackId);
      return;
    }
    if (this.comparisonsBySpotifyId.has(spotifyTrackId)) {
      this.duplicateMatchedRows += 1;
      return;
    }

    this.matchedRows += 1;
    const csvDifficulty = local.streamCountSource === STREAM_SOURCES.provisionalSpotifyFull
      ? difficultyFromSpotifyFullStreams(csvStreams)
      : difficultyFromStreams(csvStreams);
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
      streamsSource: row.streams_source ?? "",
      streamsTotalEstimated: row.streams_total_estimated ?? "",
      estimated: parseEstimated(row.streams_total_estimated),
      ratio,
      absolutePercentageError,
      difficultyMatches: local.difficulty === csvDifficulty,
    });
  }

  report(): SpotifyFullAudit {
    const comparisons = [...this.comparisonsBySpotifyId.values()];
    const confusionMatrix = emptyConfusionMatrix();
    const estimatedTrueConfusionMatrix = emptyConfusionMatrix();
    for (const comparison of comparisons) {
      confusionMatrix[comparison.localDifficulty][comparison.csvDifficulty] += 1;
      if (comparison.estimated) {
        estimatedTrueConfusionMatrix[comparison.localDifficulty][comparison.csvDifficulty] += 1;
      }
    }
    const estimatedTrue = comparisons.filter((comparison) => comparison.estimated);
    return {
      rowsRead: this.rowsRead,
      matchedIdsBeforeValidation: this.matchedSpotifyIds.size,
      validMatchedIds: comparisons.length,
      invalidMatchedIds: [...this.invalidSpotifyIds]
        .filter((spotifyTrackId) => !this.comparisonsBySpotifyId.has(spotifyTrackId)).length,
      matchedRows: this.matchedRows,
      invalidMatchedRows: this.invalidMatchedRows,
      duplicateMatchedRows: this.duplicateMatchedRows,
      comparisons,
      groups: {
        all: summarize(comparisons),
        estimatedTrue: summarize(estimatedTrue),
        estimatedFalse: summarize(comparisons.filter((comparison) => !comparison.estimated)),
        arc7ChartDump: summarize(comparisons.filter((comparison) => comparison.streamsSource === "arc7_chart_dump")),
        arc2_2023Top: summarize(comparisons.filter((comparison) => comparison.streamsSource === "arc2_2023_top")),
      },
      confusionMatrix,
      estimatedTrueConfusionMatrix,
      estimatedTrueRatioBands: ESTIMATED_RATIO_BANDS.map(({ label, matches }) => ({
        label,
        matchedTracks: estimatedTrue.filter((comparison) => (
          comparison.ratio !== null && matches(comparison.ratio)
        )).length,
      })),
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

function formatConfusionMatrix(title: string, matrix: SpotifyFullAudit["confusionMatrix"]): string[] {
  const labels = RANKED_DIFFICULTIES.map((difficulty) => difficulty[0]!.toUpperCase() + difficulty.slice(1));
  const width = 12;
  const pad = (value: string) => value.padEnd(width);
  return [
    `${title} (rows: local, columns: CSV)`,
    `${pad("Local / CSV")}${labels.map(pad).join("")}`,
    ...RANKED_DIFFICULTIES.map((localDifficulty) => (
      `${pad(localDifficulty[0]!.toUpperCase() + localDifficulty.slice(1))}${RANKED_DIFFICULTIES
        .map((csvDifficulty) => pad(String(matrix[localDifficulty][csvDifficulty])))
        .join("")}`
    )),
  ];
}

function formatPerDifficultyAgreement(title: string, comparisons: readonly StreamComparison[]): string[] {
  return [
    title,
    ...RANKED_DIFFICULTIES.map((difficulty) => {
      const row = comparisons.filter((comparison) => comparison.localDifficulty === difficulty);
      const matches = row.filter((comparison) => comparison.difficultyMatches).length;
      const label = difficulty[0]!.toUpperCase() + difficulty.slice(1);
      return `${label}: ${matches}/${row.length} (${formatNumber(row.length ? (matches / row.length) * 100 : null)}%)`;
    }),
  ];
}

function formatComparison(comparison: StreamComparison): string {
  return [
    comparison.spotifyTrackId,
    `${comparison.title} — ${comparison.artistNames}`,
    `local=${comparison.localStreams.toLocaleString()}`,
    `csv=${comparison.csvStreams.toLocaleString()}`,
    `difficulty=${comparison.localDifficulty}/${comparison.csvDifficulty}`,
    `source=${comparison.streamsSource || "(blank)"}`,
    `estimated=${comparison.streamsTotalEstimated || "(blank)"}`,
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
  const estimatedComparisons = audit.comparisons.filter((comparison) => comparison.estimated);
  const bestEstimatedMatches = [...estimatedComparisons]
    .sort((left, right) => (
      (left.absolutePercentageError ?? Number.POSITIVE_INFINITY) - (right.absolutePercentageError ?? Number.POSITIVE_INFINITY)
      || left.spotifyTrackId.localeCompare(right.spotifyTrackId)
    ))
    .slice(0, 20);
  const worstEstimatedMatches = [...estimatedComparisons]
    .sort((left, right) => (
      (right.absolutePercentageError ?? -1) - (left.absolutePercentageError ?? -1)
      || left.spotifyTrackId.localeCompare(right.spotifyTrackId)
    ))
    .slice(0, 20);

  return [
    "Spotify full stream-count audit (read-only)",
    `CSV rows read: ${audit.rowsRead}`,
    `CSV matched IDs before stream validation: ${audit.matchedIdsBeforeValidation}`,
    `Valid matched IDs: ${audit.validMatchedIds}`,
    `Invalid matched IDs: ${audit.invalidMatchedIds}`,
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
    ...formatConfusionMatrix("Difficulty confusion matrix", audit.confusionMatrix),
    "",
    ...formatPerDifficultyAgreement("Per-local-difficulty agreement", audit.comparisons),
    "",
    "estimated=True ratio bands",
    ...audit.estimatedTrueRatioBands.map((band) => `  ${band.label}: ${band.matchedTracks}`),
    "",
    ...formatPerDifficultyAgreement("estimated=True per-local-difficulty agreement", estimatedComparisons),
    "",
    ...formatConfusionMatrix("estimated=True difficulty confusion matrix", audit.estimatedTrueConfusionMatrix),
    "",
    "20 worst disagreements by absolute percentage error",
    ...(worstDisagreements.length ? worstDisagreements.map(formatComparison) : ["  None"]),
    "",
    "20 estimated=True examples with matching difficulty",
    ...(estimatedMatches.length ? estimatedMatches.map(formatComparison) : ["  None"]),
    "",
    "20 estimated=True best matches by absolute percentage error",
    ...(bestEstimatedMatches.length ? bestEstimatedMatches.map(formatComparison) : ["  None"]),
    "",
    "20 estimated=True worst matches by absolute percentage error",
    ...(worstEstimatedMatches.length ? worstEstimatedMatches.map(formatComparison) : ["  None"]),
  ].join("\n");
}
