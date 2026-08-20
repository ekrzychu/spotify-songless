import { DIFFICULTY_THRESHOLDS, difficultyFromStreams } from "@/lib/game/difficulty";
import { isRankedDifficulty, parseSpotifyFullStreams } from "@/lib/streams/spotify-full-audit";
import { isSpotifyTrackId } from "@/lib/streams/spotify-full-import";
import { STREAM_SOURCES } from "@/lib/streams/stream-sources";
import { RANKED_DIFFICULTIES, type RankedDifficulty } from "@/types/game";

export const MIN_CALIBRATION_SAMPLE_SIZE = 10;
export const MIN_VALIDATION_SAMPLE_SIZE = 20;
export const MIN_OPTIMIZATION_CLASS_SUPPORT = 10;
export const MIN_SOURCE_CALIBRATION_SUPPORT = 10;
export const MIN_OPTIMIZED_THRESHOLD = 1;
export const MIN_OPTIMIZED_THRESHOLD_GAP = 3;
export const MIN_OPTIMIZED_THRESHOLD_RATIO = 1.01;

const ASCENDING_DIFFICULTIES = ["impossible", "extreme", "hard", "normal", "easy"] as const;

export type CalibrationTrackRow = {
  spotifyTrackId: string;
  streamCount: bigint | number | null;
  difficulty: string | null;
  streamCountSource: string | null;
  title: string;
  artistNames: string;
};

export type SoundchartsReferenceTrack = {
  spotifyTrackId: string;
  soundchartsStreams: number;
  soundchartsDifficulty: RankedDifficulty;
  title: string;
  artistNames: string;
};

export type CalibrationCsvRow = {
  spotify_id?: string;
  streams_total?: string;
  streams_source?: string;
  streams_total_estimated?: string;
};

export type CalibrationComparison = SoundchartsReferenceTrack & {
  csvStreams: number;
  csvToSoundchartsRatio: number | null;
  soundchartsToCsvRatio: number | null;
  absolutePercentageError: number | null;
  streamsSource: string;
  streamsTotalEstimated: string;
  estimated: boolean;
};

export type RatioStatistics = {
  sampleSize: number;
  arithmeticMean: number | null;
  median: number | null;
  geometricMean: number | null;
  minimum: number | null;
  maximum: number | null;
  percentile10: number | null;
  percentile25: number | null;
  percentile75: number | null;
  percentile90: number | null;
};

export type CalibrationGroup = {
  id: "all" | "estimatedTrue" | "estimatedFalse" | "arc7ChartDump" | "arc2_2023Top" | "blankSource";
  label: string;
  sampleSize: number;
  sufficientSample: boolean;
  csvToSoundcharts: RatioStatistics;
  soundchartsToCsv: RatioStatistics;
  bySoundchartsDifficulty: Record<RankedDifficulty, {
    sampleSize: number;
    sufficientSample: boolean;
    csvToSoundcharts: RatioStatistics;
    soundchartsToCsv: RatioStatistics;
  }>;
};

export type CalibrationThresholds = {
  easy: number;
  normal: number;
  hard: number;
  extreme: number;
};

export type CalibrationEvaluation = {
  matches: number;
  total: number;
  accuracyPercent: number | null;
  balancedAccuracyPercent: number | null;
  macroPrecisionPercent: number | null;
  macroRecallPercent: number | null;
  macroF1Percent: number | null;
  meanOrdinalError: number | null;
  medianOrdinalError: number | null;
  withinOneBandAccuracyPercent: number | null;
  optimizationClasses: RankedDifficulty[];
  evaluationOnlyClasses: RankedDifficulty[];
  confusionMatrix: Record<RankedDifficulty, Record<RankedDifficulty, number>>;
  perDifficulty: Record<RankedDifficulty, { matches: number; total: number; accuracyPercent: number | null }>;
};

export type CalibrationMethod = {
  id: "current" | "arithmeticMean" | "median" | "geometricMean" | "optimized"
    | "balancedOptimized" | "compositeOptimized" | "sourceSpecificMedian";
  label: string;
  thresholds: CalibrationThresholds;
  evaluation: CalibrationEvaluation;
  bandCollapseWarnings: string[];
  sourceMedianCalibration?: SourceSpecificMedianCalibration;
};

export type SourceMedianCohort = "estimatedOrBlank" | "arc7ChartDump" | "globalFallback";

export type SourceMedianCohortCalibration = {
  cohort: SourceMedianCohort;
  label: string;
  sampleSize: number;
  factor: number | null;
  thresholds: CalibrationThresholds;
  usesGlobalFallback: boolean;
};

export type SourceSpecificMedianCalibration = {
  globalFactor: number | null;
  globalThresholds: CalibrationThresholds;
  cohorts: Record<SourceMedianCohort, SourceMedianCohortCalibration>;
  evaluation: CalibrationEvaluation;
};

export type ValidationMethodResult = {
  thresholds: CalibrationThresholds;
  training: CalibrationEvaluation;
  validation: CalibrationEvaluation;
};

export type SourceMedianValidationResult = {
  calibration: SourceSpecificMedianCalibration;
  training: CalibrationEvaluation;
  validation: CalibrationEvaluation;
};

export type CalibrationValidation = {
  sufficientSample: boolean;
  trainingSize: number;
  validationSize: number;
  thresholds: CalibrationThresholds | null;
  trainingAccuracyPercent: number | null;
  validationAccuracyPercent: number | null;
  balanced: ValidationMethodResult | null;
  composite: ValidationMethodResult | null;
  medianBaseline: ValidationMethodResult | null;
  sourceSpecificMedian: SourceMedianValidationResult | null;
};

export type MedianCalibrationDecision = {
  scope: "global" | "source-specific";
  reason: string;
};

export type ProvisionalCalibrationTrack = {
  spotifyTrackId: string;
  streamCount: number;
  difficulty: RankedDifficulty;
};

export type WinningSpotifyFullRow = {
  spotifyTrackId: string;
  csvStreams: number;
  streamsSource: string;
  streamsTotalEstimated: string;
  estimated: boolean;
};

export type ProductionImpactPreview = {
  currentSpotifyFullTracks: number;
  matchedWinningRows: number;
  unmatchedWinningRows: number;
  before: Record<RankedDifficulty, number>;
  after: Record<RankedDifficulty, number>;
  stayingSame: number;
  changingDifficulty: number;
  moves: Record<string, number>;
};

export type SourceAwareCalibration = {
  globalAccuracyPercent: number | null;
  sourceAwareAccuracyPercent: number | null;
  globalEvaluation: CalibrationEvaluation;
  sourceAwareEvaluation: CalibrationEvaluation;
  samples: { arc7ChartDump: number; estimatedOrBlank: number; arc2_2023Top: number; fallback: number };
  customThresholdGroups: string[];
};

export type SpotifyFullCalibrationReport = {
  soundchartsTracksIndexed: number;
  rowsRead: number;
  matchedSpotifyFullTracks: number;
  unmatchedSoundchartsTracks: number;
  invalidMatchedRows: number;
  duplicateMatchedRows: number;
  comparisons: CalibrationComparison[];
  groups: CalibrationGroup[];
  methods: CalibrationMethod[];
  validation: CalibrationValidation;
  sourceAware: SourceAwareCalibration;
  sourceSpecificMedian: SourceSpecificMedianCalibration;
  medianDecision: MedianCalibrationDecision;
  bestMethod: CalibrationMethod;
};

export const CURRENT_THRESHOLDS: CalibrationThresholds = { ...DIFFICULTY_THRESHOLDS };

export function filterSoundchartsReferenceTracks(
  rows: readonly CalibrationTrackRow[],
): Map<string, SoundchartsReferenceTrack> {
  const references = new Map<string, SoundchartsReferenceTrack>();
  for (const row of rows) {
    const difficulty = row.difficulty ?? "";
    if (
      row.streamCountSource !== STREAM_SOURCES.verifiedSoundcharts
      || row.streamCount === null
      || !isRankedDifficulty(difficulty)
    ) continue;
    const soundchartsStreams = Number(row.streamCount);
    if (!Number.isSafeInteger(soundchartsStreams) || soundchartsStreams < 0) continue;
    references.set(row.spotifyTrackId, {
      spotifyTrackId: row.spotifyTrackId,
      soundchartsStreams,
      soundchartsDifficulty: difficulty,
      title: row.title,
      artistNames: row.artistNames,
    });
  }
  return references;
}

export function percentile(values: readonly number[], quantile: number): number | null {
  if (!values.length || !Number.isFinite(quantile) || quantile < 0 || quantile > 1) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export function ratioStatistics(values: readonly number[]): RatioStatistics {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
  const arithmeticMean = valid.length
    ? valid.reduce((total, value) => total + value, 0) / valid.length
    : null;
  const geometricMean = !valid.length
    ? null
    : valid.some((value) => value === 0)
      ? 0
      : Math.exp(valid.reduce((total, value) => total + Math.log(value), 0) / valid.length);
  return {
    sampleSize: valid.length,
    arithmeticMean,
    median: percentile(valid, 0.5),
    geometricMean,
    minimum: valid.length ? Math.min(...valid) : null,
    maximum: valid.length ? Math.max(...valid) : null,
    percentile10: percentile(valid, 0.1),
    percentile25: percentile(valid, 0.25),
    percentile75: percentile(valid, 0.75),
    percentile90: percentile(valid, 0.9),
  };
}

function parseEstimated(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

function buildComparison(reference: SoundchartsReferenceTrack, row: CalibrationCsvRow, csvStreams: number) {
  const csvToSoundchartsRatio = reference.soundchartsStreams === 0
    ? null
    : csvStreams / reference.soundchartsStreams;
  return {
    ...reference,
    csvStreams,
    csvToSoundchartsRatio,
    soundchartsToCsvRatio: csvStreams === 0 ? null : reference.soundchartsStreams / csvStreams,
    absolutePercentageError: csvToSoundchartsRatio === null ? null : Math.abs(csvToSoundchartsRatio - 1) * 100,
    streamsSource: row.streams_source?.trim() ?? "",
    streamsTotalEstimated: row.streams_total_estimated?.trim() ?? "",
    estimated: parseEstimated(row.streams_total_estimated),
  } satisfies CalibrationComparison;
}

export class SpotifyFullCalibrationAccumulator {
  private rowsRead = 0;
  private invalidMatchedRows = 0;
  private duplicateMatchedRows = 0;
  private readonly candidates = new Map<string, { csvStreams: number; row: CalibrationCsvRow }>();

  constructor(private readonly references: ReadonlyMap<string, SoundchartsReferenceTrack>) {}

  consume(row: CalibrationCsvRow): void {
    this.rowsRead += 1;
    const spotifyTrackId = row.spotify_id?.trim() ?? "";
    if (!isSpotifyTrackId(spotifyTrackId) || !this.references.has(spotifyTrackId)) return;
    const csvStreams = parseSpotifyFullStreams(row.streams_total);
    if (csvStreams === null) {
      this.invalidMatchedRows += 1;
      return;
    }
    const previous = this.candidates.get(spotifyTrackId);
    if (previous) this.duplicateMatchedRows += 1;
    if (!previous || csvStreams > previous.csvStreams) this.candidates.set(spotifyTrackId, { csvStreams, row });
  }

  report(): SpotifyFullCalibrationReport {
    const comparisons = [...this.candidates]
      .map(([spotifyTrackId, candidate]) => buildComparison(
        this.references.get(spotifyTrackId)!, candidate.row, candidate.csvStreams,
      ))
      .sort((left, right) => left.spotifyTrackId.localeCompare(right.spotifyTrackId));
    return buildCalibrationReport(this.references.size, this.rowsRead, this.invalidMatchedRows, this.duplicateMatchedRows, comparisons);
  }
}

export function filterProvisionalSpotifyFullTracks(
  rows: readonly CalibrationTrackRow[],
): Map<string, ProvisionalCalibrationTrack> {
  const tracks = new Map<string, ProvisionalCalibrationTrack>();
  for (const row of rows) {
    const difficulty = row.difficulty ?? "";
    if (
      row.streamCountSource !== STREAM_SOURCES.provisionalSpotifyFull
      || row.streamCount === null
      || !isRankedDifficulty(difficulty)
    ) continue;
    const streamCount = Number(row.streamCount);
    if (!Number.isSafeInteger(streamCount) || streamCount < 0) continue;
    tracks.set(row.spotifyTrackId, {
      spotifyTrackId: row.spotifyTrackId,
      streamCount,
      difficulty,
    });
  }
  return tracks;
}

/** Retains the highest valid duplicate and the metadata from that exact row. */
export class SpotifyFullPreviewAccumulator {
  private readonly candidates = new Map<string, WinningSpotifyFullRow>();

  constructor(private readonly trackIds: ReadonlySet<string>) {}

  consume(row: CalibrationCsvRow): void {
    const spotifyTrackId = row.spotify_id?.trim() ?? "";
    if (!isSpotifyTrackId(spotifyTrackId) || !this.trackIds.has(spotifyTrackId)) return;
    const csvStreams = parseSpotifyFullStreams(row.streams_total);
    if (csvStreams === null) return;
    const previous = this.candidates.get(spotifyTrackId);
    if (previous && csvStreams <= previous.csvStreams) return;
    this.candidates.set(spotifyTrackId, {
      spotifyTrackId,
      csvStreams,
      streamsSource: row.streams_source?.trim() ?? "",
      streamsTotalEstimated: row.streams_total_estimated?.trim() ?? "",
      estimated: parseEstimated(row.streams_total_estimated),
    });
  }

  winningRows(): ReadonlyMap<string, WinningSpotifyFullRow> {
    return new Map(this.candidates);
  }
}

function emptyDifficultyCounts(): Record<RankedDifficulty, number> {
  return Object.fromEntries(RANKED_DIFFICULTIES.map((difficulty) => [difficulty, 0])) as Record<
    RankedDifficulty,
    number
  >;
}

export function buildProductionImpactPreview(
  tracks: ReadonlyMap<string, ProvisionalCalibrationTrack>,
  winningRows: ReadonlyMap<string, WinningSpotifyFullRow>,
  calibration: SourceSpecificMedianCalibration,
  scope: MedianCalibrationDecision["scope"],
): ProductionImpactPreview {
  const before = emptyDifficultyCounts();
  const after = emptyDifficultyCounts();
  const moves: Record<string, number> = {};
  let matchedWinningRows = 0;
  let stayingSame = 0;

  for (const track of tracks.values()) {
    before[track.difficulty] += 1;
    const winningRow = winningRows.get(track.spotifyTrackId);
    if (winningRow) matchedWinningRows += 1;
    const thresholds = scope === "source-specific" && winningRow
      ? sourceMedianThresholdsFor(calibration, winningRow)
      : calibration.globalThresholds;
    const nextDifficulty = difficultyFromCalibrationThresholds(track.streamCount, thresholds);
    after[nextDifficulty] += 1;
    if (nextDifficulty === track.difficulty) {
      stayingSame += 1;
    } else {
      const transition = `${track.difficulty}->${nextDifficulty}`;
      moves[transition] = (moves[transition] ?? 0) + 1;
    }
  }

  return {
    currentSpotifyFullTracks: tracks.size,
    matchedWinningRows,
    unmatchedWinningRows: tracks.size - matchedWinningRows,
    before,
    after,
    stayingSame,
    changingDifficulty: tracks.size - stayingSame,
    moves,
  };
}

function ratios(comparisons: readonly CalibrationComparison[], direction: "csv" | "soundcharts"): number[] {
  return comparisons.flatMap((comparison) => {
    const value = direction === "csv" ? comparison.csvToSoundchartsRatio : comparison.soundchartsToCsvRatio;
    return value === null ? [] : [value];
  });
}

function calibrationGroup(
  id: CalibrationGroup["id"], label: string, comparisons: readonly CalibrationComparison[],
): CalibrationGroup {
  return {
    id,
    label,
    sampleSize: comparisons.length,
    sufficientSample: comparisons.length >= MIN_CALIBRATION_SAMPLE_SIZE,
    csvToSoundcharts: ratioStatistics(ratios(comparisons, "csv")),
    soundchartsToCsv: ratioStatistics(ratios(comparisons, "soundcharts")),
    bySoundchartsDifficulty: Object.fromEntries(RANKED_DIFFICULTIES.map((difficulty) => {
      const subset = comparisons.filter((comparison) => comparison.soundchartsDifficulty === difficulty);
      return [difficulty, {
        sampleSize: subset.length,
        sufficientSample: subset.length >= MIN_CALIBRATION_SAMPLE_SIZE,
        csvToSoundcharts: ratioStatistics(ratios(subset, "csv")),
        soundchartsToCsv: ratioStatistics(ratios(subset, "soundcharts")),
      }];
    })) as CalibrationGroup["bySoundchartsDifficulty"],
  };
}

export function buildCalibrationGroups(comparisons: readonly CalibrationComparison[]): CalibrationGroup[] {
  return [
    calibrationGroup("all", "A. ALL MATCHED", comparisons),
    calibrationGroup("estimatedTrue", "B. streams_total_estimated=True", comparisons.filter((item) => item.estimated)),
    calibrationGroup("estimatedFalse", "C. streams_total_estimated=False", comparisons.filter((item) => !item.estimated)),
    calibrationGroup("arc7ChartDump", "D. streams_source=arc7_chart_dump", comparisons.filter((item) => item.streamsSource === "arc7_chart_dump")),
    calibrationGroup("arc2_2023Top", "E. streams_source=arc2_2023_top", comparisons.filter((item) => item.streamsSource === "arc2_2023_top")),
    calibrationGroup("blankSource", "F. blank streams_source", comparisons.filter((item) => item.streamsSource === "")),
  ];
}

export function scaleThresholds(factor: number | null): CalibrationThresholds | null {
  if (factor === null || !Number.isFinite(factor) || factor <= 0) return null;
  const values = {
    easy: Math.round(CURRENT_THRESHOLDS.easy * factor),
    normal: Math.round(CURRENT_THRESHOLDS.normal * factor),
    hard: Math.round(CURRENT_THRESHOLDS.hard * factor),
    extreme: Math.round(CURRENT_THRESHOLDS.extreme * factor),
  };
  if (Object.values(values).some((value) => !Number.isSafeInteger(value))) return null;
  values.extreme = Math.max(1, values.extreme);
  values.hard = Math.max(values.extreme + 1, values.hard);
  values.normal = Math.max(values.hard + 1, values.normal);
  values.easy = Math.max(values.normal + 1, values.easy);
  return values;
}

export function difficultyFromCalibrationThresholds(
  streams: number, thresholds: CalibrationThresholds,
): RankedDifficulty {
  if (streams >= thresholds.easy) return "easy";
  if (streams >= thresholds.normal) return "normal";
  if (streams >= thresholds.hard) return "hard";
  if (streams >= thresholds.extreme) return "extreme";
  return "impossible";
}

function emptyConfusionMatrix(): CalibrationEvaluation["confusionMatrix"] {
  return Object.fromEntries(RANKED_DIFFICULTIES.map((actual) => [
    actual,
    Object.fromEntries(RANKED_DIFFICULTIES.map((predicted) => [predicted, 0])),
  ])) as CalibrationEvaluation["confusionMatrix"];
}

export function evaluateThresholds(
  comparisons: readonly CalibrationComparison[],
  thresholds: CalibrationThresholds,
  optimizationClassesOverride?: readonly RankedDifficulty[],
): CalibrationEvaluation {
  return evaluatePredictions(comparisons, (comparison) => (
    difficultyFromCalibrationThresholds(comparison.csvStreams, thresholds)
  ), optimizationClassesOverride);
}

function evaluatePredictions(
  comparisons: readonly CalibrationComparison[],
  predict: (comparison: CalibrationComparison) => RankedDifficulty,
  optimizationClassesOverride?: readonly RankedDifficulty[],
): CalibrationEvaluation {
  const confusionMatrix = emptyConfusionMatrix();
  let matches = 0;
  const ordinalErrors: number[] = [];
  for (const comparison of comparisons) {
    const predicted = predict(comparison);
    confusionMatrix[comparison.soundchartsDifficulty][predicted] += 1;
    if (predicted === comparison.soundchartsDifficulty) matches += 1;
    ordinalErrors.push(ordinalDifficultyDistance(comparison.soundchartsDifficulty, predicted));
  }
  const perDifficulty = Object.fromEntries(RANKED_DIFFICULTIES.map((difficulty) => {
    const total = RANKED_DIFFICULTIES.reduce((sum, predicted) => sum + confusionMatrix[difficulty][predicted], 0);
    const difficultyMatches = confusionMatrix[difficulty][difficulty];
    return [difficulty, {
      matches: difficultyMatches,
      total,
      accuracyPercent: total ? (difficultyMatches / total) * 100 : null,
    }];
  })) as CalibrationEvaluation["perDifficulty"];
  const optimizationClasses = optimizationClassesOverride
    ? RANKED_DIFFICULTIES.filter((difficulty) => optimizationClassesOverride.includes(difficulty))
    : RANKED_DIFFICULTIES.filter((difficulty) => (
      perDifficulty[difficulty].total >= MIN_OPTIMIZATION_CLASS_SUPPORT
    ));
  const evaluationOnlyClasses = RANKED_DIFFICULTIES.filter((difficulty) => !optimizationClasses.includes(difficulty));
  const precisions = optimizationClasses.map((difficulty) => {
    const predicted = RANKED_DIFFICULTIES.reduce((sum, actual) => sum + confusionMatrix[actual][difficulty], 0);
    return predicted ? confusionMatrix[difficulty][difficulty] / predicted : 0;
  });
  const recalls = optimizationClasses.map((difficulty) => (
    perDifficulty[difficulty].total
      ? confusionMatrix[difficulty][difficulty] / perDifficulty[difficulty].total
      : 0
  ));
  const f1Scores = optimizationClasses.map((difficulty, index) => {
    const precision = precisions[index]!;
    const recall = recalls[index]!;
    return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  });
  const average = (values: readonly number[]) => (
    values.length ? values.reduce((total, value) => total + value, 0) / values.length : null
  );
  return {
    matches,
    total: comparisons.length,
    accuracyPercent: comparisons.length ? (matches / comparisons.length) * 100 : null,
    balancedAccuracyPercent: average(recalls) === null ? null : average(recalls)! * 100,
    macroPrecisionPercent: average(precisions) === null ? null : average(precisions)! * 100,
    macroRecallPercent: average(recalls) === null ? null : average(recalls)! * 100,
    macroF1Percent: average(f1Scores) === null ? null : average(f1Scores)! * 100,
    meanOrdinalError: average(ordinalErrors),
    medianOrdinalError: percentile(ordinalErrors, 0.5),
    withinOneBandAccuracyPercent: ordinalErrors.length
      ? (ordinalErrors.filter((error) => error <= 1).length / ordinalErrors.length) * 100
      : null,
    optimizationClasses,
    evaluationOnlyClasses,
    confusionMatrix,
    perDifficulty,
  };
}

export function classifySourceMedianCohort(input: {
  streamsSource: string;
  estimated: boolean;
}): SourceMedianCohort {
  if (input.streamsSource === "arc7_chart_dump") return "arc7ChartDump";
  if (input.estimated || input.streamsSource === "") return "estimatedOrBlank";
  return "globalFallback";
}

export function sourceMedianThresholdsFor(
  calibration: Pick<SourceSpecificMedianCalibration, "cohorts">,
  input: { streamsSource: string; estimated: boolean },
): CalibrationThresholds {
  return calibration.cohorts[classifySourceMedianCohort(input)].thresholds;
}

export function deriveSourceSpecificMedianCalibration(
  comparisons: readonly CalibrationComparison[],
  optimizationClassesOverride?: readonly RankedDifficulty[],
): SourceSpecificMedianCalibration {
  const globalFactor = ratioStatistics(ratios(comparisons, "csv")).median;
  const globalThresholds = scaleThresholds(globalFactor) ?? CURRENT_THRESHOLDS;
  const definitions: Array<{ cohort: SourceMedianCohort; label: string }> = [
    { cohort: "estimatedOrBlank", label: "estimated=True / blank streams_source" },
    { cohort: "arc7ChartDump", label: "streams_source=arc7_chart_dump" },
    { cohort: "globalFallback", label: "other/unknown source (global fallback)" },
  ];
  const cohorts = Object.fromEntries(definitions.map(({ cohort, label }) => {
    const subset = comparisons.filter((comparison) => classifySourceMedianCohort(comparison) === cohort);
    const ownFactor = ratioStatistics(ratios(subset, "csv")).median;
    const ownThresholds = subset.length >= MIN_SOURCE_CALIBRATION_SUPPORT ? scaleThresholds(ownFactor) : null;
    return [cohort, {
      cohort,
      label,
      sampleSize: subset.length,
      factor: ownThresholds ? ownFactor : globalFactor,
      thresholds: ownThresholds ?? globalThresholds,
      usesGlobalFallback: cohort === "globalFallback" || ownThresholds === null,
    }];
  })) as SourceSpecificMedianCalibration["cohorts"];
  const calibration = {
    globalFactor,
    globalThresholds,
    cohorts,
  };
  return {
    ...calibration,
    evaluation: evaluatePredictions(comparisons, (comparison) => (
      difficultyFromCalibrationThresholds(
        comparison.csvStreams,
        sourceMedianThresholdsFor(calibration, comparison),
      )
    ), optimizationClassesOverride),
  };
}

function thresholdCandidates(comparisons: readonly CalibrationComparison[]): number[] {
  const candidates = new Set<number>([0, 1, 2, 3]);
  let maximum = 0;
  for (const comparison of comparisons) {
    const value = comparison.csvStreams;
    maximum = Math.max(maximum, value);
    candidates.add(value);
    for (let offset = 1; offset <= 4 && value <= Number.MAX_SAFE_INTEGER - offset; offset += 1) {
      candidates.add(value + offset);
    }
  }
  for (let offset = 1; offset <= 4 && maximum <= Number.MAX_SAFE_INTEGER - offset; offset += 1) {
    candidates.add(maximum + offset);
  }
  return [...candidates].sort((left, right) => left - right);
}

/**
 * Finds four strictly increasing observed-value boundaries with dynamic programming.
 * Candidate thresholds are observed values and adjacent integers, which covers every
 * classification change without searching the full stream-count integer domain.
 */
export function optimizeThresholds(comparisons: readonly CalibrationComparison[]): CalibrationThresholds {
  if (!comparisons.length) return CURRENT_THRESHOLDS;
  const candidates = thresholdCandidates(comparisons);
  const prefix = candidates.map((threshold) => Object.fromEntries(ASCENDING_DIFFICULTIES.map((difficulty) => [
    difficulty,
    comparisons.filter((item) => item.csvStreams < threshold && item.soundchartsDifficulty === difficulty).length,
  ])) as Record<RankedDifficulty, number>);
  const interval = (difficulty: RankedDifficulty, lower: number, upper: number) => (
    prefix[upper]![difficulty] - prefix[lower]![difficulty]
  );
  const negative = Number.NEGATIVE_INFINITY;
  let scores = candidates.map((_threshold, index) => prefix[index]!.impossible);
  const parents: number[][] = [];
  for (const difficulty of ["extreme", "hard", "normal"] as const) {
    const next = candidates.map(() => negative);
    const parent = candidates.map(() => -1);
    for (let upper = 0; upper < candidates.length; upper += 1) {
      for (let lower = 0; lower < upper; lower += 1) {
        const score = scores[lower]! + interval(difficulty, lower, upper);
        if (score > next[upper]!) {
          next[upper] = score;
          parent[upper] = lower;
        }
      }
    }
    parents.push(parent);
    scores = next;
  }
  let easyIndex = -1;
  let bestScore = negative;
  for (let index = 0; index < candidates.length; index += 1) {
    const score = scores[index]! + comparisons.filter((item) => (
      item.csvStreams >= candidates[index]! && item.soundchartsDifficulty === "easy"
    )).length;
    if (score > bestScore) {
      bestScore = score;
      easyIndex = index;
    }
  }
  const normalIndex = parents[2]![easyIndex]!;
  const hardIndex = parents[1]![normalIndex]!;
  const extremeIndex = parents[0]![hardIndex]!;
  if ([easyIndex, normalIndex, hardIndex, extremeIndex].some((index) => index < 0)) return CURRENT_THRESHOLDS;
  return {
    easy: candidates[easyIndex]!,
    normal: candidates[normalIndex]!,
    hard: candidates[hardIndex]!,
    extreme: candidates[extremeIndex]!,
  };
}

type OptimizerObjective = "balanced" | "composite";
type OptimizationScore = {
  balancedRecallSum: number;
  macroF1Sum: number;
  negativeOrdinalError: number;
  exactMatches: number;
};
type OptimizationState = { score: OptimizationScore; thresholds: number[] };

function meaningfulThresholdGap(lower: number, higher: number): boolean {
  return higher - lower >= Math.max(
    MIN_OPTIMIZED_THRESHOLD_GAP,
    Math.ceil(lower * (MIN_OPTIMIZED_THRESHOLD_RATIO - 1)),
  );
}

function constrainedThresholdCandidates(comparisons: readonly CalibrationComparison[]): number[] {
  const observed = [...new Set(comparisons.map((comparison) => comparison.csvStreams))]
    .sort((left, right) => left - right);
  const candidates = new Set<number>(observed.filter((value) => value >= MIN_OPTIMIZED_THRESHOLD));
  for (let index = 1; index < observed.length; index += 1) {
    const lower = observed[index - 1]!;
    const upper = observed[index]!;
    if (upper - lower > 1) candidates.add(Math.max(1, lower + Math.floor((upper - lower) / 2)));
  }
  return [...candidates].sort((left, right) => left - right);
}

function addOptimizationScores(left: OptimizationScore, right: OptimizationScore): OptimizationScore {
  return {
    balancedRecallSum: left.balancedRecallSum + right.balancedRecallSum,
    macroF1Sum: left.macroF1Sum + right.macroF1Sum,
    negativeOrdinalError: left.negativeOrdinalError + right.negativeOrdinalError,
    exactMatches: left.exactMatches + right.exactMatches,
  };
}

function compareThresholdOrder(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
}

function isBetterOptimizationState(
  candidate: OptimizationState,
  current: OptimizationState | null,
  objective: OptimizerObjective,
): boolean {
  if (!current) return true;
  const keys: Array<keyof OptimizationScore> = objective === "composite"
    ? ["balancedRecallSum", "macroF1Sum", "negativeOrdinalError", "exactMatches"]
    : ["balancedRecallSum", "exactMatches"];
  for (const key of keys) {
    const difference = candidate.score[key] - current.score[key];
    if (Math.abs(difference) > 1e-12) return difference > 0;
  }
  return compareThresholdOrder(candidate.thresholds, current.thresholds) < 0;
}

/**
 * Optimizes contiguous difficulty bands over positive observed values/midpoints.
 * Every predicted band must contain data and adjacent thresholds must have a
 * meaningful absolute/relative gap. Balanced mode weights each supported real
 * class equally; composite mode then tie-breaks by macro-F1, ordinal error,
 * ordinary accuracy, and finally deterministic threshold order.
 */
function optimizeConstrainedThresholds(
  comparisons: readonly CalibrationComparison[], objective: OptimizerObjective,
): CalibrationThresholds {
  if (comparisons.length < RANKED_DIFFICULTIES.length) return CURRENT_THRESHOLDS;
  const candidates = constrainedThresholdCandidates(comparisons);
  if (candidates.length < 4) return CURRENT_THRESHOLDS;
  const actualSupport = Object.fromEntries(RANKED_DIFFICULTIES.map((difficulty) => [
    difficulty, comparisons.filter((item) => item.soundchartsDifficulty === difficulty).length,
  ])) as Record<RankedDifficulty, number>;
  const supported = new Set(RANKED_DIFFICULTIES.filter((difficulty) => (
    actualSupport[difficulty] >= MIN_OPTIMIZATION_CLASS_SUPPORT
  )));
  const prefix = candidates.map((threshold) => ({
    total: comparisons.filter((item) => item.csvStreams < threshold).length,
    byDifficulty: Object.fromEntries(RANKED_DIFFICULTIES.map((difficulty) => [
      difficulty,
      comparisons.filter((item) => (
        item.csvStreams < threshold && item.soundchartsDifficulty === difficulty
      )).length,
    ])) as Record<RankedDifficulty, number>,
  }));
  const intervalCounts = (lower: number | null, upper: number | null) => {
    const lowerTotal = lower === null ? 0 : prefix[lower]!.total;
    const upperTotal = upper === null ? comparisons.length : prefix[upper]!.total;
    return {
      total: upperTotal - lowerTotal,
      byDifficulty: Object.fromEntries(RANKED_DIFFICULTIES.map((difficulty) => [
        difficulty,
        (upper === null ? actualSupport[difficulty] : prefix[upper]!.byDifficulty[difficulty])
          - (lower === null ? 0 : prefix[lower]!.byDifficulty[difficulty]),
      ])) as Record<RankedDifficulty, number>,
    };
  };
  const bandScore = (
    predicted: RankedDifficulty, lower: number | null, upper: number | null,
  ): OptimizationScore | null => {
    const counts = intervalCounts(lower, upper);
    if (counts.total === 0) return null;
    const truePositive = counts.byDifficulty[predicted];
    const classSupport = actualSupport[predicted];
    const precision = truePositive / counts.total;
    const recall = classSupport ? truePositive / classSupport : 0;
    return {
      balancedRecallSum: supported.has(predicted) ? recall : 0,
      macroF1Sum: supported.has(predicted) && precision + recall
        ? (2 * precision * recall) / (precision + recall)
        : 0,
      negativeOrdinalError: -RANKED_DIFFICULTIES.reduce((total, actual) => (
        total + counts.byDifficulty[actual]
          * Math.abs(RANKED_DIFFICULTIES.indexOf(actual) - RANKED_DIFFICULTIES.indexOf(predicted))
      ), 0),
      exactMatches: truePositive,
    };
  };

  let states: Array<OptimizationState | null> = candidates.map((_threshold, index) => {
    const score = bandScore("impossible", null, index);
    return score ? { score, thresholds: [candidates[index]!] } : null;
  });
  for (const predicted of ["extreme", "hard", "normal"] as const) {
    const next: Array<OptimizationState | null> = candidates.map(() => null);
    for (let upper = 0; upper < candidates.length; upper += 1) {
      for (let lower = 0; lower < upper; lower += 1) {
        const previous = states[lower];
        if (!previous || !meaningfulThresholdGap(candidates[lower]!, candidates[upper]!)) continue;
        const score = bandScore(predicted, lower, upper);
        if (!score) continue;
        const candidate = {
          score: addOptimizationScores(previous.score, score),
          thresholds: [...previous.thresholds, candidates[upper]!],
        };
        if (isBetterOptimizationState(candidate, next[upper] ?? null, objective)) next[upper] = candidate;
      }
    }
    states = next;
  }
  let best: OptimizationState | null = null;
  for (let lower = 0; lower < candidates.length; lower += 1) {
    const previous = states[lower];
    const score = bandScore("easy", lower, null);
    if (!previous || !score) continue;
    const candidate = { score: addOptimizationScores(previous.score, score), thresholds: previous.thresholds };
    if (isBetterOptimizationState(candidate, best, objective)) best = candidate;
  }
  if (!best || best.thresholds.length !== 4) return CURRENT_THRESHOLDS;
  return {
    extreme: best.thresholds[0]!,
    hard: best.thresholds[1]!,
    normal: best.thresholds[2]!,
    easy: best.thresholds[3]!,
  };
}

export function optimizeBalancedThresholds(
  comparisons: readonly CalibrationComparison[],
): CalibrationThresholds {
  return optimizeConstrainedThresholds(comparisons, "balanced");
}

export function optimizeCompositeThresholds(
  comparisons: readonly CalibrationComparison[],
): CalibrationThresholds {
  return optimizeConstrainedThresholds(comparisons, "composite");
}

export function detectBandCollapse(
  thresholds: CalibrationThresholds,
  comparisons: readonly CalibrationComparison[],
): string[] {
  const warnings: string[] = [];
  const ascending = [thresholds.extreme, thresholds.hard, thresholds.normal, thresholds.easy];
  if (thresholds.extreme < MIN_OPTIMIZED_THRESHOLD) {
    warnings.push(`Extreme threshold is below ${MIN_OPTIMIZED_THRESHOLD}.`);
  }
  for (let index = 1; index < ascending.length; index += 1) {
    if (!meaningfulThresholdGap(ascending[index - 1]!, ascending[index]!)) {
      warnings.push(`Adjacent thresholds ${ascending[index - 1]} and ${ascending[index]} have a practically meaningless gap.`);
    }
  }
  for (const difficulty of RANKED_DIFFICULTIES) {
    const predicted = comparisons.filter((comparison) => (
      difficultyFromCalibrationThresholds(comparison.csvStreams, thresholds) === difficulty
    )).length;
    if (comparisons.length && predicted === 0) warnings.push(`No observed track is classified as ${difficulty}.`);
  }
  return warnings;
}

export function stableCalibrationBucket(spotifyTrackId: string, buckets = 5): number {
  let hash = 2_166_136_261;
  for (const character of spotifyTrackId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % buckets;
}

export function validateOptimizedThresholds(
  comparisons: readonly CalibrationComparison[],
): CalibrationValidation {
  const { training, validation } = splitCalibrationValidation(comparisons);
  const sufficientSample = comparisons.length >= MIN_VALIDATION_SAMPLE_SIZE && training.length > 0 && validation.length > 0;
  if (!sufficientSample) return {
    sufficientSample: false,
    trainingSize: training.length,
    validationSize: validation.length,
    thresholds: null,
    trainingAccuracyPercent: null,
    validationAccuracyPercent: null,
    balanced: null,
    composite: null,
    medianBaseline: null,
    sourceSpecificMedian: null,
  };
  const balancedThresholds = optimizeBalancedThresholds(training);
  const compositeThresholds = optimizeCompositeThresholds(training);
  const trainingMedian = buildCalibrationGroups(training)[0]!.csvToSoundcharts.median;
  const medianThresholds = scaleThresholds(trainingMedian) ?? CURRENT_THRESHOLDS;
  const validationClasses = RANKED_DIFFICULTIES.filter((difficulty) => (
    comparisons.filter((item) => item.soundchartsDifficulty === difficulty).length
      >= MIN_OPTIMIZATION_CLASS_SUPPORT
  ));
  const sourceMedianCalibration = deriveSourceSpecificMedianCalibration(training, validationClasses);
  const sourceMedianValidation = evaluatePredictions(validation, (comparison) => (
    difficultyFromCalibrationThresholds(
      comparison.csvStreams,
      sourceMedianThresholdsFor(sourceMedianCalibration, comparison),
    )
  ), validationClasses);
  const balanced = {
    thresholds: balancedThresholds,
    training: evaluateThresholds(training, balancedThresholds, validationClasses),
    validation: evaluateThresholds(validation, balancedThresholds, validationClasses),
  };
  const composite = {
    thresholds: compositeThresholds,
    training: evaluateThresholds(training, compositeThresholds, validationClasses),
    validation: evaluateThresholds(validation, compositeThresholds, validationClasses),
  };
  return {
    sufficientSample: true,
    trainingSize: training.length,
    validationSize: validation.length,
    thresholds: compositeThresholds,
    trainingAccuracyPercent: composite.training.accuracyPercent,
    validationAccuracyPercent: composite.validation.accuracyPercent,
    balanced,
    composite,
    medianBaseline: {
      thresholds: medianThresholds,
      training: evaluateThresholds(training, medianThresholds, validationClasses),
      validation: evaluateThresholds(validation, medianThresholds, validationClasses),
    },
    sourceSpecificMedian: {
      calibration: sourceMedianCalibration,
      training: sourceMedianCalibration.evaluation,
      validation: sourceMedianValidation,
    },
  };
}

export function splitCalibrationValidation(
  comparisons: readonly CalibrationComparison[],
): { training: CalibrationComparison[]; validation: CalibrationComparison[] } {
  const validationIds = new Set<string>();
  for (const difficulty of RANKED_DIFFICULTIES) {
    const rows = comparisons.filter((item) => item.soundchartsDifficulty === difficulty)
      .sort((left, right) => (
        stableCalibrationBucket(left.spotifyTrackId, 1_000_003)
        - stableCalibrationBucket(right.spotifyTrackId, 1_000_003)
        || left.spotifyTrackId.localeCompare(right.spotifyTrackId)
      ));
    const validationCount = rows.length >= 2 ? Math.max(1, Math.floor(rows.length / 5)) : 0;
    rows.slice(0, validationCount).forEach((row) => validationIds.add(row.spotifyTrackId));
  }
  return {
    training: comparisons.filter((item) => !validationIds.has(item.spotifyTrackId)),
    validation: comparisons.filter((item) => validationIds.has(item.spotifyTrackId)),
  };
}

export function recommendMedianCalibrationScope(
  globalMedian: CalibrationEvaluation,
  sourceSpecificMedian: CalibrationEvaluation,
): MedianCalibrationDecision {
  const sourceOrdinalWorsening = metricDifference(
    sourceSpecificMedian.meanOrdinalError,
    globalMedian.meanOrdinalError,
  );
  if (sourceOrdinalWorsening === null || sourceOrdinalWorsening > 0.05) {
    return {
      scope: "global",
      reason: "Source-specific median does not qualify because validation ordinal error is unavailable or clearly worse.",
    };
  }
  const priorities: Array<{ label: string; improvement: number | null; meaningful: number }> = [
    {
      label: "macro-F1",
      improvement: metricDifference(sourceSpecificMedian.macroF1Percent, globalMedian.macroF1Percent),
      meaningful: 1,
    },
    {
      label: "balanced accuracy",
      improvement: metricDifference(
        sourceSpecificMedian.balancedAccuracyPercent,
        globalMedian.balancedAccuracyPercent,
      ),
      meaningful: 1,
    },
    {
      label: "mean ordinal error",
      improvement: metricDifference(globalMedian.meanOrdinalError, sourceSpecificMedian.meanOrdinalError),
      meaningful: 0.05,
    },
    {
      label: "ordinary accuracy",
      improvement: metricDifference(sourceSpecificMedian.accuracyPercent, globalMedian.accuracyPercent),
      meaningful: 1,
    },
    {
      label: "within-one-band accuracy",
      improvement: metricDifference(
        sourceSpecificMedian.withinOneBandAccuracyPercent,
        globalMedian.withinOneBandAccuracyPercent,
      ),
      meaningful: 1,
    },
  ];
  for (const priority of priorities) {
    if (priority.improvement === null || Math.abs(priority.improvement) < priority.meaningful) continue;
    return priority.improvement > 0
      ? {
        scope: "source-specific",
        reason: `Source-specific median has a meaningful validation ${priority.label} improvement without worse ordinal behavior.`,
      }
      : {
        scope: "global",
        reason: `Global median is preferred because source-specific median materially worsens validation ${priority.label}.`,
      };
  }
  return {
    scope: "global",
    reason: "Validation results are essentially tied, so global median is preferred for simplicity and lower overfitting risk.",
  };
}

function sourceCohort(comparison: CalibrationComparison): "arc7" | "estimatedOrBlank" | "arc2" | "fallback" {
  if (comparison.streamsSource === "arc7_chart_dump") return "arc7";
  if (comparison.estimated || comparison.streamsSource === "") return "estimatedOrBlank";
  if (comparison.streamsSource === "arc2_2023_top") return "arc2";
  return "fallback";
}

function sourceAwareCalibration(
  comparisons: readonly CalibrationComparison[], globalThresholds: CalibrationThresholds,
): SourceAwareCalibration {
  const cohorts = {
    arc7: comparisons.filter((item) => sourceCohort(item) === "arc7"),
    estimatedOrBlank: comparisons.filter((item) => sourceCohort(item) === "estimatedOrBlank"),
    arc2: comparisons.filter((item) => sourceCohort(item) === "arc2"),
    fallback: comparisons.filter((item) => sourceCohort(item) === "fallback"),
  };
  const custom = new Map<string, CalibrationThresholds>();
  for (const [id, cohort] of Object.entries(cohorts)) {
    const supportedClasses = RANKED_DIFFICULTIES.filter((difficulty) => (
      cohort.filter((item) => item.soundchartsDifficulty === difficulty).length >= MIN_OPTIMIZATION_CLASS_SUPPORT
    ));
    if (cohort.length >= MIN_CALIBRATION_SAMPLE_SIZE && supportedClasses.length >= 2) {
      custom.set(id, optimizeCompositeThresholds(cohort));
    }
  }
  const sourceAwareEvaluation = evaluatePredictions(comparisons, (comparison) => {
    const thresholds = custom.get(sourceCohort(comparison)) ?? globalThresholds;
    return difficultyFromCalibrationThresholds(comparison.csvStreams, thresholds);
  });
  const globalEvaluation = evaluateThresholds(comparisons, globalThresholds);
  return {
    globalAccuracyPercent: globalEvaluation.accuracyPercent,
    sourceAwareAccuracyPercent: sourceAwareEvaluation.accuracyPercent,
    globalEvaluation,
    sourceAwareEvaluation,
    samples: {
      arc7ChartDump: cohorts.arc7.length,
      estimatedOrBlank: cohorts.estimatedOrBlank.length,
      arc2_2023Top: cohorts.arc2.length,
      fallback: cohorts.fallback.length,
    },
    customThresholdGroups: [...custom.keys()],
  };
}

function calibrationMethods(comparisons: readonly CalibrationComparison[], all: CalibrationGroup): CalibrationMethod[] {
  const thresholdMethods: Array<Omit<CalibrationMethod, "evaluation" | "bandCollapseWarnings">> = [
    { id: "current", label: "A. Current production thresholds", thresholds: CURRENT_THRESHOLDS },
    { id: "arithmeticMean", label: "B. Arithmetic-mean scaled", thresholds: scaleThresholds(all.csvToSoundcharts.arithmeticMean) ?? CURRENT_THRESHOLDS },
    { id: "median", label: "C. Median-scaled", thresholds: scaleThresholds(all.csvToSoundcharts.median) ?? CURRENT_THRESHOLDS },
    { id: "geometricMean", label: "D. Geometric-mean scaled", thresholds: scaleThresholds(all.csvToSoundcharts.geometricMean) ?? CURRENT_THRESHOLDS },
    { id: "optimized", label: "E. Raw-accuracy optimized (diagnostic only)", thresholds: optimizeThresholds(comparisons) },
    { id: "balancedOptimized", label: "F. Balanced-accuracy optimized", thresholds: optimizeBalancedThresholds(comparisons) },
    { id: "compositeOptimized", label: "G. Composite game-oriented optimized", thresholds: optimizeCompositeThresholds(comparisons) },
  ];
  const methods = thresholdMethods.map((method): CalibrationMethod => ({
    ...method,
    evaluation: evaluateThresholds(comparisons, method.thresholds),
    bandCollapseWarnings: detectBandCollapse(method.thresholds, comparisons),
  }));
  const sourceMedianCalibration = deriveSourceSpecificMedianCalibration(comparisons);
  methods.push({
    id: "sourceSpecificMedian",
    label: "H. Source-specific median-scaled",
    thresholds: sourceMedianCalibration.globalThresholds,
    evaluation: sourceMedianCalibration.evaluation,
    bandCollapseWarnings: [...new Set(Object.values(sourceMedianCalibration.cohorts).flatMap((cohort) => (
      detectBandCollapse(cohort.thresholds, comparisons).map((warning) => `${cohort.label}: ${warning}`)
    )))],
    sourceMedianCalibration,
  });
  return methods;
}

function buildCalibrationReport(
  soundchartsTracksIndexed: number,
  rowsRead: number,
  invalidMatchedRows: number,
  duplicateMatchedRows: number,
  comparisons: CalibrationComparison[],
): SpotifyFullCalibrationReport {
  const groups = buildCalibrationGroups(comparisons);
  const methods = calibrationMethods(comparisons, groups[0]!);
  const validation = validateOptimizedThresholds(comparisons);
  const median = methods.find((method) => method.id === "median")!;
  const composite = methods.find((method) => method.id === "compositeOptimized")!;
  const sourceSpecificMedian = methods.find((method) => method.id === "sourceSpecificMedian")!;
  const medianDecision = validation.sufficientSample
    ? recommendMedianCalibrationScope(
      validation.medianBaseline!.validation,
      validation.sourceSpecificMedian!.validation,
    )
    : {
      scope: "global" as const,
      reason: "The matched sample is insufficient for validation, so global median is preferred for simplicity.",
    };
  const bestMethod = medianDecision.scope === "source-specific" ? sourceSpecificMedian : median;
  return {
    soundchartsTracksIndexed,
    rowsRead,
    matchedSpotifyFullTracks: comparisons.length,
    unmatchedSoundchartsTracks: soundchartsTracksIndexed - comparisons.length,
    invalidMatchedRows,
    duplicateMatchedRows,
    comparisons,
    groups,
    methods,
    validation,
    sourceAware: sourceAwareCalibration(comparisons, composite.thresholds),
    sourceSpecificMedian: sourceSpecificMedian.sourceMedianCalibration!,
    medianDecision,
    bestMethod,
  };
}

function formatNumber(value: number | null, digits = 4): string {
  return value === null ? "N/A" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatPercent(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(2)}%`;
}

function metricDifference(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left - right;
}

function formatSignedDifference(value: number | null, suffix = ""): string {
  if (value === null) return "N/A";
  return `${value >= 0 ? "+" : ""}${formatNumber(value, 2)}${suffix}`;
}

function formatRatioStatistics(title: string, stats: RatioStatistics): string[] {
  return [
    `  ${title} (n=${stats.sampleSize})`,
    `    Arithmetic mean: ${formatNumber(stats.arithmeticMean)}`,
    `    MEDIAN: ${formatNumber(stats.median)}`,
    `    Geometric mean: ${formatNumber(stats.geometricMean)}`,
    `    Minimum / P10 / P25: ${formatNumber(stats.minimum)} / ${formatNumber(stats.percentile10)} / ${formatNumber(stats.percentile25)}`,
    `    P75 / P90 / Maximum: ${formatNumber(stats.percentile75)} / ${formatNumber(stats.percentile90)} / ${formatNumber(stats.maximum)}`,
  ];
}

function formatThresholds(thresholds: CalibrationThresholds): string {
  return `Easy >= ${thresholds.easy.toLocaleString()} | Normal >= ${thresholds.normal.toLocaleString()} | Hard >= ${thresholds.hard.toLocaleString()} | Extreme >= ${thresholds.extreme.toLocaleString()}`;
}

function formatScaledThresholds(factor: number | null): string {
  const thresholds = scaleThresholds(factor);
  return thresholds ? formatThresholds(thresholds) : "unavailable (factor is zero or invalid)";
}

function formatConfusionMatrix(evaluation: CalibrationEvaluation): string[] {
  const width = 12;
  const label = (difficulty: RankedDifficulty) => difficulty[0]!.toUpperCase() + difficulty.slice(1);
  const pad = (value: string) => value.padEnd(width);
  return [
    `${pad("Soundcharts")}${RANKED_DIFFICULTIES.map((item) => pad(label(item))).join("")}`,
    ...RANKED_DIFFICULTIES.map((actual) => (
      `${pad(label(actual))}${RANKED_DIFFICULTIES.map((predicted) => pad(String(evaluation.confusionMatrix[actual][predicted]))).join("")}`
    )),
  ];
}

function formatEvaluationMetrics(evaluation: CalibrationEvaluation, indent = "  "): string[] {
  return [
    `${indent}Exact matches / ordinary accuracy: ${evaluation.matches}/${evaluation.total} (${formatPercent(evaluation.accuracyPercent)})`,
    `${indent}Balanced accuracy: ${formatPercent(evaluation.balancedAccuracyPercent)}`,
    `${indent}Macro precision / recall / F1: ${formatPercent(evaluation.macroPrecisionPercent)} / ${formatPercent(evaluation.macroRecallPercent)} / ${formatPercent(evaluation.macroF1Percent)}`,
    `${indent}Mean / median ordinal error: ${formatNumber(evaluation.meanOrdinalError)} / ${formatNumber(evaluation.medianOrdinalError)}`,
    `${indent}Within-one-band accuracy: ${formatPercent(evaluation.withinOneBandAccuracyPercent)}`,
  ];
}

export function ordinalDifficultyDistance(left: RankedDifficulty, right: RankedDifficulty): number {
  return Math.abs(ASCENDING_DIFFICULTIES.indexOf(left) - ASCENDING_DIFFICULTIES.indexOf(right));
}

function formatExample(comparison: CalibrationComparison, predicted: RankedDifficulty): string {
  const current = difficultyFromStreams(comparison.csvStreams);
  return [
    comparison.spotifyTrackId,
    `${comparison.title} — ${comparison.artistNames}`,
    `spotify_full=${comparison.csvStreams.toLocaleString()}`,
    `Soundcharts=${comparison.soundchartsStreams.toLocaleString()}`,
    `ratio=${formatNumber(comparison.csvToSoundchartsRatio)}`,
    `difficulty=${comparison.soundchartsDifficulty}/${current}/${predicted}`,
    `source=${comparison.streamsSource || "(blank)"}`,
    `estimated=${comparison.streamsTotalEstimated || "(blank)"}`,
  ].join(" | ");
}

function formatMedianDeltas(
  sourceSpecific: CalibrationEvaluation,
  global: CalibrationEvaluation,
  indent = "",
): string[] {
  return [
    `${indent}Ordinary accuracy: ${formatSignedDifference(metricDifference(sourceSpecific.accuracyPercent, global.accuracyPercent), " pp")}`,
    `${indent}Balanced accuracy: ${formatSignedDifference(metricDifference(sourceSpecific.balancedAccuracyPercent, global.balancedAccuracyPercent), " pp")}`,
    `${indent}Macro-F1: ${formatSignedDifference(metricDifference(sourceSpecific.macroF1Percent, global.macroF1Percent), " pp")}`,
    `${indent}Mean ordinal error: ${formatSignedDifference(metricDifference(sourceSpecific.meanOrdinalError, global.meanOrdinalError))} (negative is better)`,
    `${indent}Within-one-band accuracy: ${formatSignedDifference(metricDifference(sourceSpecific.withinOneBandAccuracyPercent, global.withinOneBandAccuracyPercent), " pp")}`,
  ];
}

function formatSourceMedianCalibration(calibration: SourceSpecificMedianCalibration, indent = ""): string[] {
  return [
    `${indent}Global factor: ${formatNumber(calibration.globalFactor)}`,
    `${indent}Global thresholds: ${formatThresholds(calibration.globalThresholds)}`,
    ...Object.values(calibration.cohorts).flatMap((cohort) => [
      `${indent}${cohort.label}: n=${cohort.sampleSize}; factor=${formatNumber(cohort.factor)}${cohort.usesGlobalFallback ? "; GLOBAL FALLBACK" : ""}`,
      `${indent}  Thresholds: ${formatThresholds(cohort.thresholds)}`,
    ]),
  ];
}

function formatProductionPreview(preview: ProductionImpactPreview | undefined): string[] {
  if (!preview) return ["Production preview unavailable."];
  return [
    `Current provisional spotify_full tracks: ${preview.currentSpotifyFullTracks}`,
    `Tracks matched to a valid winning CSV row: ${preview.matchedWinningRows}`,
    `Tracks without a valid winning CSV row (global fallback): ${preview.unmatchedWinningRows}`,
    "Current difficulty distribution:",
    ...RANKED_DIFFICULTIES.map((difficulty) => `  ${difficulty}: ${preview.before[difficulty]}`),
    "Would become under recommended calibration:",
    ...RANKED_DIFFICULTIES.map((difficulty) => `  ${difficulty}: ${preview.after[difficulty]}`),
    `Number staying in same difficulty: ${preview.stayingSame}`,
    `Number changing difficulty: ${preview.changingDifficulty}`,
    "Moves (all directions):",
    ...RANKED_DIFFICULTIES.flatMap((from) => RANKED_DIFFICULTIES
      .filter((to) => to !== from)
      .map((to) => `  ${from} -> ${to}: ${preview.moves[`${from}->${to}`] ?? 0}`)),
  ];
}

export function formatSpotifyFullCalibration(
  report: SpotifyFullCalibrationReport,
  displayPath: string,
  productionPreview?: ProductionImpactPreview,
): string {
  const current = report.methods.find((method) => method.id === "current")!;
  const medianMethod = report.methods.find((method) => method.id === "median")!;
  const balancedMethod = report.methods.find((method) => method.id === "balancedOptimized")!;
  const compositeMethod = report.methods.find((method) => method.id === "compositeOptimized")!;
  const sourceMedianMethod = report.methods.find((method) => method.id === "sourceSpecificMedian")!;
  const calibrated = report.bestMethod;
  const predictRecommended = (comparison: CalibrationComparison) => difficultyFromCalibrationThresholds(
    comparison.csvStreams,
    report.medianDecision.scope === "source-specific"
      ? sourceMedianThresholdsFor(report.sourceSpecificMedian, comparison)
      : report.sourceSpecificMedian.globalThresholds,
  );
  const currentWrong = report.comparisons.filter((comparison) => (
    difficultyFromStreams(comparison.csvStreams) !== comparison.soundchartsDifficulty
  )).sort((left, right) => (
    ordinalDifficultyDistance(right.soundchartsDifficulty, difficultyFromStreams(right.csvStreams))
    - ordinalDifficultyDistance(left.soundchartsDifficulty, difficultyFromStreams(left.csvStreams))
    || (right.absolutePercentageError ?? -1) - (left.absolutePercentageError ?? -1)
    || left.spotifyTrackId.localeCompare(right.spotifyTrackId)
  ));
  const fixed = currentWrong.filter((comparison) => (
    predictRecommended(comparison) === comparison.soundchartsDifficulty
  ));
  const stillWrong = report.comparisons.filter((comparison) => (
    predictRecommended(comparison) !== comparison.soundchartsDifficulty
  )).sort((left, right) => (
    ordinalDifficultyDistance(
      right.soundchartsDifficulty,
      predictRecommended(right),
    ) - ordinalDifficultyDistance(
      left.soundchartsDifficulty,
      predictRecommended(left),
    ) || left.spotifyTrackId.localeCompare(right.spotifyTrackId)
  ));
  const insufficient = report.groups.flatMap((group) => [
    ...(!group.sufficientSample ? [group.label] : []),
    ...RANKED_DIFFICULTIES.filter((difficulty) => !group.bySoundchartsDifficulty[difficulty].sufficientSample)
      .map((difficulty) => `${group.label} / ${difficulty}`),
  ]);
  const sourceImprovement = (report.sourceAware.sourceAwareAccuracyPercent ?? 0)
    - (report.sourceAware.globalAccuracyPercent ?? 0);
  const sourceBalancedImprovement = (report.sourceAware.sourceAwareEvaluation.balancedAccuracyPercent ?? 0)
    - (report.sourceAware.globalEvaluation.balancedAccuracyPercent ?? 0);
  const sourceMacroF1Improvement = (report.sourceAware.sourceAwareEvaluation.macroF1Percent ?? 0)
    - (report.sourceAware.globalEvaluation.macroF1Percent ?? 0);
  const sufficientGlobalSample = report.matchedSpotifyFullTracks >= MIN_CALIBRATION_SAMPLE_SIZE;
  const optimizationClasses = compositeMethod.evaluation.optimizationClasses;
  const evaluationOnlyClasses = compositeMethod.evaluation.evaluationOnlyClasses;
  const recommendationReason = report.medianDecision.reason;
  const methodWarnings = report.methods.flatMap((method) => (
    method.bandCollapseWarnings.map((warning) => `${method.label}: ${warning}`)
  ));
  const recommendedValidation = report.medianDecision.scope === "source-specific"
    ? report.validation.sourceSpecificMedian
    : report.validation.medianBaseline;
  return [
    "SPOTIFY_FULL VS SOUNDCHARTS CALIBRATION (READ-ONLY)",
    "", `Input: ${displayPath}`, "",
    `CSV rows read: ${report.rowsRead.toLocaleString()}`,
    `Soundcharts tracks indexed: ${report.soundchartsTracksIndexed}`,
    `Matched spotify_full tracks: ${report.matchedSpotifyFullTracks}`,
    `Unmatched Soundcharts tracks: ${report.unmatchedSoundchartsTracks}`,
    `Invalid matched rows: ${report.invalidMatchedRows}`,
    `Duplicate matched rows: ${report.duplicateMatchedRows}`,
    "",
    "RATIO STATISTICS",
    ...report.groups.flatMap((group) => [
      "", `${group.label} (n=${group.sampleSize})${group.sufficientSample ? "" : " — INSUFFICIENT SAMPLE FOR A FACTOR RECOMMENDATION"}`,
      ...formatRatioStatistics("CSV / Soundcharts", group.csvToSoundcharts),
      ...formatRatioStatistics("Soundcharts / CSV", group.soundchartsToCsv),
      "  By real Soundcharts difficulty:",
      ...RANKED_DIFFICULTIES.flatMap((difficulty) => {
        const item = group.bySoundchartsDifficulty[difficulty];
        return [
          `    ${difficulty}: n=${item.sampleSize}${item.sufficientSample ? "" : " — insufficient for a factor recommendation"}`,
          ...formatRatioStatistics("CSV / Soundcharts", item.csvToSoundcharts).map((line) => `  ${line}`),
          ...formatRatioStatistics("Soundcharts / CSV", item.soundchartsToCsv).map((line) => `  ${line}`),
        ];
      }),
    ]),
    "",
    "SIMPLE SCALE-FACTOR CANDIDATE THRESHOLDS",
    ...report.groups.filter((group) => group.id === "all" || group.id === "estimatedTrue" || group.id === "arc7ChartDump")
      .flatMap((group) => {
        if (!group.sufficientSample) return [`${group.label}: insufficient sample (n=${group.sampleSize})`];
        return [
          group.label,
          `  Arithmetic mean: ${formatScaledThresholds(group.csvToSoundcharts.arithmeticMean)}`,
          `  MEDIAN: ${formatScaledThresholds(group.csvToSoundcharts.median)}`,
          `  Geometric mean: ${formatScaledThresholds(group.csvToSoundcharts.geometricMean)}`,
        ];
      }),
    "",
    "METHOD EVALUATION",
    ...report.methods.flatMap((method) => [
      "", method.label,
      `  Thresholds: ${formatThresholds(method.thresholds)}`,
      ...(method.sourceMedianCalibration ? [
        "  Deterministic cohort rules:",
        "    arc7_chart_dump -> arc7 cohort, regardless of estimated flag",
        "    estimated=True OR blank streams_source -> estimated/blank cohort",
        "    all other and future sources -> global fallback",
        `  Minimum cohort support for an independent factor: ${MIN_SOURCE_CALIBRATION_SUPPORT}`,
        ...formatSourceMedianCalibration(method.sourceMedianCalibration, "  "),
      ] : []),
      ...formatEvaluationMetrics(method.evaluation),
      `  Classes driving balanced metrics: ${method.evaluation.optimizationClasses.join(", ") || "none"}`,
      `  Evaluation-only classes: ${method.evaluation.evaluationOnlyClasses.join(", ") || "none"}`,
      ...(method.bandCollapseWarnings.length
        ? ["  BAND-COLLAPSE WARNING:", ...method.bandCollapseWarnings.map((warning) => `    ${warning}`)]
        : ["  Band-collapse check: passed"]),
      "  Confusion matrix (rows: Soundcharts; columns: provisional classification)",
      ...formatConfusionMatrix(method.evaluation).map((line) => `  ${line}`),
      "  Per-Soundcharts-difficulty recall:",
      ...RANKED_DIFFICULTIES.map((difficulty) => {
        const item = method.evaluation.perDifficulty[difficulty];
        return `    ${difficulty}: ${item.matches}/${item.total} (${formatPercent(item.accuracyPercent)})`;
      }),
    ]),
    "",
    "GLOBAL MEDIAN-SCALED VS SOURCE-SPECIFIC MEDIAN-SCALED (FULL SAMPLE)",
    "Global median-scaled:",
    ...formatEvaluationMetrics(medianMethod.evaluation, "  "),
    "Source-specific median-scaled:",
    ...formatEvaluationMetrics(sourceMedianMethod.evaluation, "  "),
    "Source-specific minus global deltas:",
    ...formatMedianDeltas(sourceMedianMethod.evaluation, medianMethod.evaluation, "  "),
    "",
    "BALANCED OPTIMIZERS VS MEDIAN-SCALED BASELINE",
    `Balanced optimizer: balanced accuracy ${formatSignedDifference(metricDifference(balancedMethod.evaluation.balancedAccuracyPercent, medianMethod.evaluation.balancedAccuracyPercent), " pp")}; macro-F1 ${formatSignedDifference(metricDifference(balancedMethod.evaluation.macroF1Percent, medianMethod.evaluation.macroF1Percent), " pp")}; mean ordinal error ${formatSignedDifference(metricDifference(balancedMethod.evaluation.meanOrdinalError, medianMethod.evaluation.meanOrdinalError))} (lower is better)`,
    `Composite optimizer: balanced accuracy ${formatSignedDifference(metricDifference(compositeMethod.evaluation.balancedAccuracyPercent, medianMethod.evaluation.balancedAccuracyPercent), " pp")}; macro-F1 ${formatSignedDifference(metricDifference(compositeMethod.evaluation.macroF1Percent, medianMethod.evaluation.macroF1Percent), " pp")}; mean ordinal error ${formatSignedDifference(metricDifference(compositeMethod.evaluation.meanOrdinalError, medianMethod.evaluation.meanOrdinalError))} (lower is better)`,
    ...(report.validation.sufficientSample ? [
      `Validation balanced vs median: balanced accuracy ${formatSignedDifference(metricDifference(report.validation.balanced!.validation.balancedAccuracyPercent, report.validation.medianBaseline!.validation.balancedAccuracyPercent), " pp")}; macro-F1 ${formatSignedDifference(metricDifference(report.validation.balanced!.validation.macroF1Percent, report.validation.medianBaseline!.validation.macroF1Percent), " pp")}; mean ordinal error ${formatSignedDifference(metricDifference(report.validation.balanced!.validation.meanOrdinalError, report.validation.medianBaseline!.validation.meanOrdinalError))}`,
      `Validation composite vs median: balanced accuracy ${formatSignedDifference(metricDifference(report.validation.composite!.validation.balancedAccuracyPercent, report.validation.medianBaseline!.validation.balancedAccuracyPercent), " pp")}; macro-F1 ${formatSignedDifference(metricDifference(report.validation.composite!.validation.macroF1Percent, report.validation.medianBaseline!.validation.macroF1Percent), " pp")}; mean ordinal error ${formatSignedDifference(metricDifference(report.validation.composite!.validation.meanOrdinalError, report.validation.medianBaseline!.validation.meanOrdinalError))}`,
    ] : ["Validation comparison unavailable: insufficient sample."]),
    "",
    "DETERMINISTIC STRATIFIED VALIDATION (stable Spotify-ID hash ordering; approximately 80/20 per class)",
    `Training sample: ${report.validation.trainingSize}`,
    `Validation sample: ${report.validation.validationSize}`,
    ...(report.validation.sufficientSample ? [
      `Training class sizes: ${RANKED_DIFFICULTIES.map((difficulty) => `${difficulty}=${report.validation.composite!.training.perDifficulty[difficulty].total}`).join(", ")}`,
      `Validation class sizes: ${RANKED_DIFFICULTIES.map((difficulty) => `${difficulty}=${report.validation.composite!.validation.perDifficulty[difficulty].total}`).join(", ")}`,
      "Median-scaled baseline (factor derived from training only):",
      `  Thresholds: ${formatThresholds(report.validation.medianBaseline!.thresholds)}`,
      "  Training:",
      ...formatEvaluationMetrics(report.validation.medianBaseline!.training, "    "),
      "  Validation:",
      ...formatEvaluationMetrics(report.validation.medianBaseline!.validation, "    "),
      "Source-specific median-scaled (all factors derived from training only):",
      ...formatSourceMedianCalibration(report.validation.sourceSpecificMedian!.calibration, "  "),
      "  Training:",
      ...formatEvaluationMetrics(report.validation.sourceSpecificMedian!.training, "    "),
      "  Validation:",
      ...formatEvaluationMetrics(report.validation.sourceSpecificMedian!.validation, "    "),
      "  Validation deltas (source-specific minus global):",
      ...formatMedianDeltas(
        report.validation.sourceSpecificMedian!.validation,
        report.validation.medianBaseline!.validation,
        "    ",
      ),
      "Balanced optimizer:",
      `  Thresholds: ${formatThresholds(report.validation.balanced!.thresholds)}`,
      "  Training:",
      ...formatEvaluationMetrics(report.validation.balanced!.training, "    "),
      "  Validation:",
      ...formatEvaluationMetrics(report.validation.balanced!.validation, "    "),
      "Composite game-oriented optimizer:",
      `  Thresholds: ${formatThresholds(report.validation.composite!.thresholds)}`,
      "  Training:",
      ...formatEvaluationMetrics(report.validation.composite!.training, "    "),
      "  Validation:",
      ...formatEvaluationMetrics(report.validation.composite!.validation, "    "),
    ] : ["INSUFFICIENT SAMPLE FOR MEANINGFUL VALIDATION"]),
    "",
    "LEGACY SOURCE-AWARE COMPOSITE DIAGNOSTIC (NOT USED FOR THE MEDIAN-SCOPE DECISION)",
    `Global composite ordinary accuracy: ${formatPercent(report.sourceAware.globalAccuracyPercent)}`,
    `Source-aware composite ordinary accuracy: ${formatPercent(report.sourceAware.sourceAwareAccuracyPercent)} (${sourceImprovement >= 0 ? "+" : ""}${formatNumber(sourceImprovement, 2)} pp)`,
    `Global / source-aware balanced accuracy: ${formatPercent(report.sourceAware.globalEvaluation.balancedAccuracyPercent)} / ${formatPercent(report.sourceAware.sourceAwareEvaluation.balancedAccuracyPercent)} (${sourceBalancedImprovement >= 0 ? "+" : ""}${formatNumber(sourceBalancedImprovement, 2)} pp)`,
    `Global / source-aware macro-F1: ${formatPercent(report.sourceAware.globalEvaluation.macroF1Percent)} / ${formatPercent(report.sourceAware.sourceAwareEvaluation.macroF1Percent)} (${sourceMacroF1Improvement >= 0 ? "+" : ""}${formatNumber(sourceMacroF1Improvement, 2)} pp)`,
    `Global / source-aware mean ordinal error: ${formatNumber(report.sourceAware.globalEvaluation.meanOrdinalError)} / ${formatNumber(report.sourceAware.sourceAwareEvaluation.meanOrdinalError)}`,
    `arc7_chart_dump n=${report.sourceAware.samples.arc7ChartDump}`,
    `estimated=True / blank-source cohort (excluding arc7) n=${report.sourceAware.samples.estimatedOrBlank}`,
    `arc2_2023_top n=${report.sourceAware.samples.arc2_2023Top}${report.sourceAware.samples.arc2_2023Top < MIN_CALIBRATION_SAMPLE_SIZE ? " — insufficient" : ""}`,
    `Other/fallback n=${report.sourceAware.samples.fallback}`,
    `Groups with independently optimized thresholds: ${report.sourceAware.customThresholdGroups.join(", ") || "none"}`,
    "",
    "10 TRACKS WHERE CURRENT RAW CLASSIFICATION IS MOST WRONG",
    ...(currentWrong.length
      ? currentWrong.slice(0, 10).map((item) => formatExample(item, predictRecommended(item))) : ["None"]),
    "",
    "10 TRACKS FIXED BY RECOMMENDED CALIBRATION",
    ...(fixed.length
      ? fixed.slice(0, 10).map((item) => formatExample(item, predictRecommended(item))) : ["None"]),
    "",
    "10 TRACKS STILL WRONG AFTER RECOMMENDED CALIBRATION",
    ...(stillWrong.length
      ? stillWrong.slice(0, 10).map((item) => formatExample(item, predictRecommended(item))) : ["None"]),
    "",
    "CALIBRATION SUMMARY",
    `Matched sample size: ${report.matchedSpotifyFullTracks}`,
    "Reference class distribution:",
    ...RANKED_DIFFICULTIES.map((difficulty) => `  ${difficulty}: ${current.evaluation.perDifficulty[difficulty].total}`),
    `Classes included in optimization (minimum support ${MIN_OPTIMIZATION_CLASS_SUPPORT}): ${optimizationClasses.join(", ") || "none"}`,
    `Classes evaluation-only due insufficient support: ${evaluationOnlyClasses.join(", ") || "none"}`,
    "",
    "Current raw-threshold:",
    ...formatEvaluationMetrics(current.evaluation, "  "),
    "Median-scaled:",
    ...formatEvaluationMetrics(medianMethod.evaluation, "  "),
    "Balanced optimized:",
    ...formatEvaluationMetrics(balancedMethod.evaluation, "  "),
    "Composite game-oriented optimized:",
    ...formatEvaluationMetrics(compositeMethod.evaluation, "  "),
    "Source-specific median-scaled:",
    ...formatEvaluationMetrics(sourceMedianMethod.evaluation, "  "),
    "",
    `Recommended method: ${sufficientGlobalSample ? report.bestMethod.label : "none — insufficient global sample"}`,
    `Recommended provisional thresholds: ${sufficientGlobalSample && report.medianDecision.scope === "global"
      ? formatThresholds(report.sourceSpecificMedian.globalThresholds)
      : sufficientGlobalSample ? "source-specific factors and thresholds listed below" : "none — insufficient global sample"}`,
    `Why this method was recommended: ${sufficientGlobalSample ? recommendationReason : "The matched sample is below the minimum recommendation size."}`,
    `Recommended calibration scope: ${sufficientGlobalSample ? report.medianDecision.scope : "none — collect more matched Soundcharts tracks"}`,
    `Validation metrics: ${report.validation.sufficientSample && recommendedValidation
      ? `${calibrated.label}: ordinary=${formatPercent(recommendedValidation.validation.accuracyPercent)}, balanced=${formatPercent(recommendedValidation.validation.balancedAccuracyPercent)}, macro-F1=${formatPercent(recommendedValidation.validation.macroF1Percent)}, mean ordinal=${formatNumber(recommendedValidation.validation.meanOrdinalError)}`
      : "insufficient sample"}`,
    `Warnings: ${[...methodWarnings, ...insufficient, ...(evaluationOnlyClasses.length
      ? [`Insufficient class support: ${evaluationOnlyClasses.join(", ")}`] : [])].join("; ") || "none"}`,
    "",
    "FINAL MEDIAN CALIBRATION DECISION",
    `Matched Soundcharts sample: ${report.matchedSpotifyFullTracks}`,
    `Global median factor: ${formatNumber(report.sourceSpecificMedian.globalFactor)}`,
    "Source-specific cohort factors:",
    ...Object.values(report.sourceSpecificMedian.cohorts).map((cohort) => (
      `  ${cohort.label}: n=${cohort.sampleSize}; factor=${formatNumber(cohort.factor)}${cohort.usesGlobalFallback ? "; GLOBAL FALLBACK" : ""}`
    )),
    "Global median validation:",
    ...(report.validation.medianBaseline
      ? formatEvaluationMetrics(report.validation.medianBaseline.validation, "  ")
      : ["  Insufficient sample"]),
    "Source-specific median validation:",
    ...(report.validation.sourceSpecificMedian
      ? formatEvaluationMetrics(report.validation.sourceSpecificMedian.validation, "  ")
      : ["  Insufficient sample"]),
    `Recommended scope: ${report.medianDecision.scope}`,
    "Recommended thresholds/factors:",
    ...(report.medianDecision.scope === "source-specific"
      ? formatSourceMedianCalibration(report.sourceSpecificMedian, "  ")
      : [
        `  Factor: ${formatNumber(report.sourceSpecificMedian.globalFactor)}`,
        `  Thresholds: ${formatThresholds(report.sourceSpecificMedian.globalThresholds)}`,
      ]),
    `Reason: ${report.medianDecision.reason}`,
    "",
    "PRODUCTION IMPACT PREVIEW:",
    ...formatProductionPreview(productionPreview),
    "",
    "Still informational only. No database writes or production threshold changes were performed.",
  ].join("\n");
}
