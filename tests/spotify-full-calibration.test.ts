import { describe, expect, it } from "vitest";
import { resolveDatasetFile } from "@/lib/streams/data-file";
import {
  CURRENT_THRESHOLDS,
  MIN_OPTIMIZATION_CLASS_SUPPORT,
  MIN_SOURCE_CALIBRATION_SUPPORT,
  SpotifyFullCalibrationAccumulator,
  SpotifyFullPreviewAccumulator,
  buildCalibrationGroups,
  buildProductionImpactPreview,
  classifySourceMedianCohort,
  deriveSourceSpecificMedianCalibration,
  detectBandCollapse,
  difficultyFromCalibrationThresholds,
  evaluateThresholds,
  filterSoundchartsReferenceTracks,
  filterProvisionalSpotifyFullTracks,
  formatSpotifyFullCalibration,
  optimizeThresholds,
  optimizeBalancedThresholds,
  optimizeCompositeThresholds,
  ordinalDifficultyDistance,
  percentile,
  ratioStatistics,
  recommendMedianCalibrationScope,
  scaleThresholds,
  stableCalibrationBucket,
  splitCalibrationValidation,
  validateOptimizedThresholds,
  type CalibrationComparison,
  type CalibrationTrackRow,
  type SoundchartsReferenceTrack,
} from "@/lib/streams/spotify-full-calibration";
import type { RankedDifficulty } from "@/types/game";

const ID = "1234567890123456789012";

function databaseTrack(overrides: Partial<CalibrationTrackRow> = {}): CalibrationTrackRow {
  return {
    spotifyTrackId: ID,
    streamCount: 250_000_000n,
    difficulty: "normal",
    streamCountSource: "soundcharts",
    title: "Reference Song",
    artistNames: "Reference Artist",
    ...overrides,
  };
}

function reference(overrides: Partial<SoundchartsReferenceTrack> = {}): SoundchartsReferenceTrack {
  return {
    spotifyTrackId: ID,
    soundchartsStreams: 250_000_000,
    soundchartsDifficulty: "normal",
    title: "Reference Song",
    artistNames: "Reference Artist",
    ...overrides,
  };
}

function comparison(overrides: Partial<CalibrationComparison> = {}): CalibrationComparison {
  const base = reference();
  return {
    ...base,
    csvStreams: 125_000_000,
    csvToSoundchartsRatio: 0.5,
    soundchartsToCsvRatio: 2,
    absolutePercentageError: 50,
    streamsSource: "arc7_chart_dump",
    streamsTotalEstimated: "false",
    estimated: false,
    ...overrides,
  };
}

describe("Soundcharts calibration reference filtering", () => {
  it("indexes only valid Soundcharts-owned ranked rows", () => {
    const references = filterSoundchartsReferenceTracks([
      databaseTrack(),
      databaseTrack({ spotifyTrackId: "2234567890123456789012", streamCountSource: "spotify_full" }),
      databaseTrack({ spotifyTrackId: "3234567890123456789012", streamCountSource: "csv" }),
      databaseTrack({ spotifyTrackId: "4234567890123456789012", streamCount: null }),
      databaseTrack({ spotifyTrackId: "5234567890123456789012", difficulty: null }),
    ]);
    expect([...references.keys()]).toEqual([ID]);
  });

  it("explicitly excludes spotify_full-owned tracks from ground truth", () => {
    expect(filterSoundchartsReferenceTracks([
      databaseTrack({ streamCountSource: "spotify_full" }),
    ])).toHaveLength(0);
  });
});

describe("ratio statistics", () => {
  it("calculates ratios, reciprocal ratios, and absolute percentage error", () => {
    const accumulator = new SpotifyFullCalibrationAccumulator(new Map([[ID, reference()]]));
    accumulator.consume({ spotify_id: ID, streams_total: "125000000.4" });
    expect(accumulator.report().comparisons[0]).toMatchObject({
      csvStreams: 125_000_000,
      csvToSoundchartsRatio: 0.5,
      soundchartsToCsvRatio: 2,
      absolutePercentageError: 50,
    });
  });

  it("calculates mean, median, geometric mean, and interpolated percentiles", () => {
    const stats = ratioStatistics([1, 2, 4, 8]);
    expect(stats.arithmeticMean).toBe(3.75);
    expect(stats.median).toBe(3);
    expect(stats.geometricMean).toBeCloseTo(Math.pow(64, 0.25));
    expect(stats).toMatchObject({ percentile10: 1.3, percentile25: 1.75, percentile75: 5 });
    expect(stats.percentile90).toBeCloseTo(6.8);
    expect(percentile([4, 1, 2, 8], 0.5)).toBe(3);
  });

  it("handles zero denominators and zero geometric means without infinities", () => {
    const zeroCsv = new SpotifyFullCalibrationAccumulator(new Map([[ID, reference()]]));
    zeroCsv.consume({ spotify_id: ID, streams_total: "0" });
    expect(zeroCsv.report().comparisons[0]).toMatchObject({
      csvToSoundchartsRatio: 0,
      soundchartsToCsvRatio: null,
      absolutePercentageError: 100,
    });
    expect(ratioStatistics([0, 1, 4]).geometricMean).toBe(0);

    const zeroSoundcharts = new SpotifyFullCalibrationAccumulator(new Map([[
      ID, reference({ soundchartsStreams: 0, soundchartsDifficulty: "impossible" }),
    ]]));
    zeroSoundcharts.consume({ spotify_id: ID, streams_total: "10" });
    expect(zeroSoundcharts.report().comparisons[0]).toMatchObject({
      csvToSoundchartsRatio: null,
      soundchartsToCsvRatio: 0,
      absolutePercentageError: null,
    });
  });
});

describe("streaming matching and grouping", () => {
  it("uses the highest valid duplicate and retains that row's metadata", () => {
    const accumulator = new SpotifyFullCalibrationAccumulator(new Map([[ID, reference()]]));
    accumulator.consume({
      spotify_id: ID, streams_total: "100.4", streams_source: "arc7_chart_dump", streams_total_estimated: "false",
    });
    accumulator.consume({
      spotify_id: ID, streams_total: "200.7", streams_source: "arc2_2023_top", streams_total_estimated: "true",
    });
    accumulator.consume({ spotify_id: ID, streams_total: "invalid" });
    const report = accumulator.report();
    expect(report).toMatchObject({ duplicateMatchedRows: 1, invalidMatchedRows: 1, matchedSpotifyFullTracks: 1 });
    expect(report.comparisons[0]).toMatchObject({
      csvStreams: 201, streamsSource: "arc2_2023_top", estimated: true,
    });
  });

  it("separates estimated, source, blank-source, and real-difficulty groups", () => {
    const groups = buildCalibrationGroups([
      comparison(),
      comparison({ spotifyTrackId: "2234567890123456789012", estimated: true, streamsTotalEstimated: "true", streamsSource: "" }),
      comparison({ spotifyTrackId: "3234567890123456789012", streamsSource: "arc2_2023_top", soundchartsDifficulty: "hard" }),
    ]);
    expect(groups.find((group) => group.id === "estimatedTrue")?.sampleSize).toBe(1);
    expect(groups.find((group) => group.id === "estimatedFalse")?.sampleSize).toBe(2);
    expect(groups.find((group) => group.id === "arc7ChartDump")?.sampleSize).toBe(1);
    expect(groups.find((group) => group.id === "arc2_2023Top")?.bySoundchartsDifficulty.hard.sampleSize).toBe(1);
    expect(groups.find((group) => group.id === "blankSource")?.sampleSize).toBe(1);
  });
});

describe("source-specific median calibration", () => {
  const ratioRows = (
    count: number,
    start: number,
    ratio: number,
    streamsSource: string,
    estimated: boolean,
  ) => Array.from({ length: count }, (_, index) => comparison({
    spotifyTrackId: String(start + index).padStart(22, "0"),
    csvStreams: Math.round(250_000_000 * ratio),
    csvToSoundchartsRatio: ratio,
    soundchartsToCsvRatio: 1 / ratio,
    absolutePercentageError: Math.abs(ratio - 1) * 100,
    streamsSource,
    streamsTotalEstimated: String(estimated),
    estimated,
  }));

  it("classifies source cohorts deterministically with arc7 precedence", () => {
    expect(classifySourceMedianCohort({ streamsSource: "arc7_chart_dump", estimated: true }))
      .toBe("arc7ChartDump");
    expect(classifySourceMedianCohort({ streamsSource: "", estimated: false }))
      .toBe("estimatedOrBlank");
    expect(classifySourceMedianCohort({ streamsSource: "future_source", estimated: true }))
      .toBe("estimatedOrBlank");
    expect(classifySourceMedianCohort({ streamsSource: "arc2_2023_top", estimated: false }))
      .toBe("globalFallback");
  });

  it("derives supported cohort median factors independently", () => {
    expect(MIN_SOURCE_CALIBRATION_SUPPORT).toBe(10);
    const calibration = deriveSourceSpecificMedianCalibration([
      ...ratioRows(10, 1, 0.5, "", true),
      ...ratioRows(10, 101, 2, "arc7_chart_dump", false),
    ]);
    expect(calibration.globalFactor).toBe(1.25);
    expect(calibration.cohorts.estimatedOrBlank).toMatchObject({
      sampleSize: 10, factor: 0.5, usesGlobalFallback: false,
    });
    expect(calibration.cohorts.arc7ChartDump).toMatchObject({
      sampleSize: 10, factor: 2, usesGlobalFallback: false,
    });
    expect(calibration.cohorts.estimatedOrBlank.thresholds.easy).toBe(500_000_000);
    expect(calibration.cohorts.arc7ChartDump.thresholds.easy).toBe(2_000_000_000);
  });

  it("falls back to the global factor below minimum cohort support", () => {
    const calibration = deriveSourceSpecificMedianCalibration([
      ...ratioRows(10, 1, 0.5, "", true),
      ...ratioRows(2, 101, 2, "arc7_chart_dump", false),
    ]);
    expect(calibration.globalFactor).toBe(0.5);
    expect(calibration.cohorts.arc7ChartDump).toMatchObject({
      sampleSize: 2, factor: 0.5, usesGlobalFallback: true,
    });
    expect(calibration.cohorts.arc7ChartDump.thresholds).toEqual(calibration.globalThresholds);
  });

  it("derives global and cohort validation factors from training only", () => {
    const rows = [
      ...ratioRows(20, 1, 0.5, "", true),
      ...ratioRows(20, 101, 2, "arc7_chart_dump", false),
    ];
    const split = splitCalibrationValidation(rows);
    const validationIds = new Set(split.validation.map((row) => row.spotifyTrackId));
    const changedValidation = rows.map((row) => validationIds.has(row.spotifyTrackId) ? {
      ...row,
      csvToSoundchartsRatio: 100,
      soundchartsToCsvRatio: 0.01,
      csvStreams: 25_000_000_000,
    } : row);
    const original = validateOptimizedThresholds(rows);
    const changed = validateOptimizedThresholds(changedValidation);
    expect(changed.sourceSpecificMedian?.calibration.globalFactor)
      .toBe(original.sourceSpecificMedian?.calibration.globalFactor);
    expect(changed.sourceSpecificMedian?.calibration.cohorts.estimatedOrBlank.factor)
      .toBe(original.sourceSpecificMedian?.calibration.cohorts.estimatedOrBlank.factor);
    expect(changed.sourceSpecificMedian?.calibration.cohorts.arc7ChartDump.factor)
      .toBe(original.sourceSpecificMedian?.calibration.cohorts.arc7ChartDump.factor);
    expect(changed.sourceSpecificMedian?.validation.total).toBe(changed.medianBaseline?.validation.total);
    for (const difficulty of ["easy", "normal", "hard", "extreme", "impossible"] as const) {
      expect(changed.sourceSpecificMedian?.validation.perDifficulty[difficulty].total)
        .toBe(changed.medianBaseline?.validation.perDifficulty[difficulty].total);
    }
  });

  it("prefers global median when validation evaluations tie", () => {
    const evaluation = evaluateThresholds(ratioRows(10, 1, 1, "arc7_chart_dump", false), CURRENT_THRESHOLDS);
    expect(recommendMedianCalibrationScope(evaluation, evaluation)).toMatchObject({ scope: "global" });
  });
});

describe("read-only production impact preview", () => {
  const SECOND_ID = "2234567890123456789012";

  it("retains metadata from the highest valid duplicate row", () => {
    const accumulator = new SpotifyFullPreviewAccumulator(new Set([ID]));
    accumulator.consume({
      spotify_id: ID, streams_total: "100", streams_source: "arc7_chart_dump", streams_total_estimated: "false",
    });
    accumulator.consume({
      spotify_id: ID, streams_total: "200.6", streams_source: "", streams_total_estimated: "true",
    });
    accumulator.consume({
      spotify_id: ID, streams_total: "150", streams_source: "arc2_2023_top", streams_total_estimated: "false",
    });
    expect(accumulator.winningRows().get(ID)).toMatchObject({
      csvStreams: 201, streamsSource: "", streamsTotalEstimated: "true", estimated: true,
    });
  });

  it("computes difficulty transitions without mutating track or winner inputs", () => {
    const databaseRows = Object.freeze([
      Object.freeze(databaseTrack({
        streamCountSource: "spotify_full", streamCount: 40_000_000n, difficulty: "impossible",
      })),
      Object.freeze(databaseTrack({
        spotifyTrackId: SECOND_ID, streamCountSource: "spotify_full", streamCount: 600_000_000n, difficulty: "normal",
      })),
    ]);
    const tracks = filterProvisionalSpotifyFullTracks(databaseRows);
    const winners = new Map([
      [ID, { spotifyTrackId: ID, csvStreams: 40_000_000, streamsSource: "arc7_chart_dump", streamsTotalEstimated: "false", estimated: false }],
      [SECOND_ID, { spotifyTrackId: SECOND_ID, csvStreams: 600_000_000, streamsSource: "", streamsTotalEstimated: "true", estimated: true }],
    ]);
    const calibration = deriveSourceSpecificMedianCalibration([
      ...Array.from({ length: 10 }, (_, index) => comparison({
        spotifyTrackId: String(index + 1).padStart(22, "0"), csvToSoundchartsRatio: 0.5,
      })),
    ]);
    const tracksSnapshot = [...tracks.entries()];
    const winnersSnapshot = [...winners.entries()];
    const preview = buildProductionImpactPreview(tracks, winners, calibration, "global");
    expect(preview).toMatchObject({
      currentSpotifyFullTracks: 2,
      matchedWinningRows: 2,
      stayingSame: 0,
      changingDifficulty: 2,
    });
    expect(preview.before).toMatchObject({ impossible: 1, normal: 1 });
    expect(preview.after).toMatchObject({ hard: 1, easy: 1 });
    expect(preview.moves).toMatchObject({ "impossible->hard": 1, "normal->easy": 1 });
    expect([...tracks.entries()]).toEqual(tracksSnapshot);
    expect([...winners.entries()]).toEqual(winnersSnapshot);
  });
});

describe("threshold calibration", () => {
  it("scales canonical thresholds without changing production constants", () => {
    expect(scaleThresholds(0.5)).toEqual({
      easy: 500_000_000, normal: 125_000_000, hard: 25_000_000, extreme: 5_000_000,
    });
    expect(CURRENT_THRESHOLDS).toEqual({
      easy: 1_000_000_000, normal: 250_000_000, hard: 50_000_000, extreme: 10_000_000,
    });
    expect(scaleThresholds(0)).toBeNull();
  });

  it("calculates balanced accuracy and macro precision, recall, and F1 over supported classes", () => {
    const rows: CalibrationComparison[] = [];
    for (let index = 0; index < 10; index += 1) {
      rows.push(comparison({
        spotifyTrackId: String(index + 1).padStart(22, "0"),
        soundchartsDifficulty: "easy",
        csvStreams: index < 8 ? 1_000_000_000 : 250_000_000,
      }));
      rows.push(comparison({
        spotifyTrackId: String(index + 101).padStart(22, "0"),
        soundchartsDifficulty: "normal",
        csvStreams: index < 6 ? 250_000_000 : 50_000_000,
      }));
    }
    const evaluation = evaluateThresholds(rows, CURRENT_THRESHOLDS);
    expect(MIN_OPTIMIZATION_CLASS_SUPPORT).toBe(10);
    expect(evaluation.optimizationClasses).toEqual(["easy", "normal"]);
    expect(evaluation.balancedAccuracyPercent).toBeCloseTo(70);
    expect(evaluation.macroPrecisionPercent).toBeCloseTo(87.5);
    expect(evaluation.macroRecallPercent).toBeCloseTo(70);
    expect(evaluation.macroF1Percent).toBeCloseTo(77.7777778);
  });

  it("calculates ordinal distance, mean/median error, and within-one-band accuracy", () => {
    expect(ordinalDifficultyDistance("easy", "normal")).toBe(1);
    expect(ordinalDifficultyDistance("easy", "impossible")).toBe(4);
    const evaluation = evaluateThresholds([
      comparison({ spotifyTrackId: "1234567890123456789001", soundchartsDifficulty: "easy", csvStreams: 1_000_000_000 }),
      comparison({ spotifyTrackId: "1234567890123456789002", soundchartsDifficulty: "easy", csvStreams: 250_000_000 }),
      comparison({ spotifyTrackId: "1234567890123456789003", soundchartsDifficulty: "easy", csvStreams: 50_000_000 }),
    ], CURRENT_THRESHOLDS);
    expect(evaluation.meanOrdinalError).toBe(1);
    expect(evaluation.medianOrdinalError).toBe(1);
    expect(evaluation.withinOneBandAccuracyPercent).toBeCloseTo(66.6666667);
  });

  it("keeps under-supported classes in evaluation without letting them drive balanced metrics", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, index) => comparison({
        spotifyTrackId: String(index + 1).padStart(22, "0"),
        soundchartsDifficulty: "easy" as const,
        csvStreams: 1_000_000_000,
      })),
      ...Array.from({ length: 9 }, (_, index) => comparison({
        spotifyTrackId: String(index + 101).padStart(22, "0"),
        soundchartsDifficulty: "hard" as const,
        csvStreams: 50_000_000,
      })),
    ];
    const evaluation = evaluateThresholds(rows, CURRENT_THRESHOLDS);
    expect(evaluation.optimizationClasses).toEqual(["easy"]);
    expect(evaluation.evaluationOnlyClasses).toContain("hard");
    expect(evaluation.perDifficulty.hard).toMatchObject({ matches: 9, total: 9, accuracyPercent: 100 });
  });

  it("detects collapsed or practically meaningless bands", () => {
    const rows = [comparison({ csvStreams: 10, soundchartsDifficulty: "easy" })];
    const warnings = detectBandCollapse({ easy: 10, normal: 3, hard: 2, extreme: 1 }, rows);
    expect(warnings.some((warning) => warning.includes("meaningless gap"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("No observed track"))).toBe(true);
  });

  it("produces strict five-band balanced and composite thresholds with deterministic ties", () => {
    const clusters: Array<[number, RankedDifficulty]> = [
      [10, "impossible"], [100, "extreme"], [1_000, "hard"], [10_000, "normal"], [100_000, "easy"],
    ];
    const rows = clusters.flatMap(([csvStreams, soundchartsDifficulty], classIndex) => (
      Array.from({ length: 10 }, (_, index) => comparison({
        spotifyTrackId: String(classIndex * 100 + index + 1).padStart(22, "0"),
        csvStreams,
        soundchartsDifficulty,
      }))
    ));
    const balanced = optimizeBalancedThresholds(rows);
    const composite = optimizeCompositeThresholds(rows);
    for (const thresholds of [balanced, composite]) {
      expect(thresholds.extreme).toBeGreaterThanOrEqual(1);
      expect(thresholds.hard).toBeGreaterThan(thresholds.extreme);
      expect(thresholds.normal).toBeGreaterThan(thresholds.hard);
      expect(thresholds.easy).toBeGreaterThan(thresholds.normal);
      expect(detectBandCollapse(thresholds, rows)).toEqual([]);
      expect(evaluateThresholds(rows, thresholds).balancedAccuracyPercent).toBe(100);
    }
    expect(optimizeBalancedThresholds([...rows].reverse())).toEqual(balanced);
    expect(optimizeCompositeThresholds([...rows].reverse())).toEqual(composite);
  });

  it("finds deterministic monotonic optimized thresholds", () => {
    const labelled: Array<[number, RankedDifficulty]> = [
      [5, "impossible"], [15, "extreme"], [30, "hard"], [60, "normal"], [120, "easy"],
    ];
    const rows = labelled.map(([csvStreams, soundchartsDifficulty], index) => comparison({
      spotifyTrackId: String(index + 1).padStart(22, "0"),
      csvStreams,
      soundchartsDifficulty,
    }));
    const thresholds = optimizeThresholds(rows);
    expect(thresholds.easy).toBeGreaterThan(thresholds.normal);
    expect(thresholds.normal).toBeGreaterThan(thresholds.hard);
    expect(thresholds.hard).toBeGreaterThan(thresholds.extreme);
    expect(evaluateThresholds(rows, thresholds).matches).toBe(5);
    expect(optimizeThresholds([...rows].reverse())).toEqual(thresholds);

    const sparseLabels = [
      comparison({ spotifyTrackId: "1234567890123456789001", csvStreams: 10, soundchartsDifficulty: "impossible" }),
      comparison({ spotifyTrackId: "1234567890123456789002", csvStreams: 100, soundchartsDifficulty: "easy" }),
    ];
    const sparseThresholds = optimizeThresholds(sparseLabels);
    expect(evaluateThresholds(sparseLabels, sparseThresholds).matches).toBe(2);
    expect(sparseThresholds.easy).toBeGreaterThan(sparseThresholds.normal);
    expect(sparseThresholds.normal).toBeGreaterThan(sparseThresholds.hard);
    expect(sparseThresholds.hard).toBeGreaterThan(sparseThresholds.extreme);
  });

  it("builds a confusion matrix and per-difficulty accuracy", () => {
    const rows = [
      comparison({ spotifyTrackId: "1234567890123456789001", csvStreams: 1_000_000_000, soundchartsDifficulty: "easy" }),
      comparison({ spotifyTrackId: "1234567890123456789002", csvStreams: 1_000_000_000, soundchartsDifficulty: "normal" }),
    ];
    const evaluation = evaluateThresholds(rows, CURRENT_THRESHOLDS);
    expect(evaluation).toMatchObject({ matches: 1, total: 2, accuracyPercent: 50 });
    expect(evaluation.confusionMatrix.easy.easy).toBe(1);
    expect(evaluation.confusionMatrix.normal.easy).toBe(1);
    expect(evaluation.perDifficulty.normal).toMatchObject({ matches: 0, total: 1, accuracyPercent: 0 });
    expect(difficultyFromCalibrationThresholds(9_999_999, CURRENT_THRESHOLDS)).toBe("impossible");
  });

  it("uses a stable Spotify-ID validation split", () => {
    expect(stableCalibrationBucket(ID)).toBe(stableCalibrationBucket(ID));
    const rows = Array.from({ length: 60 }, (_, index) => {
      const difficulty: RankedDifficulty = index % 5 === 0 ? "easy"
        : index % 5 === 1 ? "normal"
          : index % 5 === 2 ? "hard"
            : index % 5 === 3 ? "extreme" : "impossible";
      const csvStreams = {
        easy: 500, normal: 250, hard: 100, extreme: 50, impossible: 10,
      }[difficulty];
      return comparison({
        spotifyTrackId: String(index + 1).padStart(22, "0"), csvStreams, soundchartsDifficulty: difficulty,
      });
    });
    const validation = validateOptimizedThresholds(rows);
    expect(validation.sufficientSample).toBe(true);
    expect(validation.trainingSize + validation.validationSize).toBe(60);
    expect(validation.trainingAccuracyPercent).toBe(100);
    expect(validation.validationAccuracyPercent).toBe(100);
    expect(validation.balanced?.training.balancedAccuracyPercent).not.toBeNull();
    expect(validation.composite?.validation.macroF1Percent).not.toBeNull();
    expect(validation.medianBaseline?.validation.meanOrdinalError).not.toBeNull();
    const splitIds = (items: CalibrationComparison[]) => items.map((item) => item.spotifyTrackId).sort();
    const forward = splitCalibrationValidation(rows);
    const reversed = splitCalibrationValidation([...rows].reverse());
    expect(splitIds(reversed.training)).toEqual(splitIds(forward.training));
    expect(splitIds(reversed.validation)).toEqual(splitIds(forward.validation));
  });
});

describe("calibration data filename", () => {
  it("reuses direct data/ filename resolution and rejects arbitrary paths", async () => {
    await expect(resolveDatasetFile("spotify_full.csv", {
      repositoryRoot: "C:\\repo", fileExists: async () => true,
    })).resolves.toMatchObject({ displayPath: "data/spotify_full.csv" });
    await expect(resolveDatasetFile("../spotify_full.csv", { fileExists: async () => true })).rejects.toThrow("file name");
    await expect(resolveDatasetFile("C:\\spotify_full.csv", { fileExists: async () => true })).rejects.toThrow("file name");
  });

  it("reports median comparison, diagnostics, validation, and final decision sections", () => {
    const accumulator = new SpotifyFullCalibrationAccumulator(new Map([[ID, reference()]]));
    accumulator.consume({ spotify_id: ID, streams_total: "125000000" });
    const output = formatSpotifyFullCalibration(accumulator.report(), "data/spotify_full.csv");
    expect(output).toContain("Raw-accuracy optimized (diagnostic only)");
    expect(output).toContain("Balanced-accuracy optimized");
    expect(output).toContain("Composite game-oriented optimized");
    expect(output).toContain("H. Source-specific median-scaled");
    expect(output).toContain("GLOBAL MEDIAN-SCALED VS SOURCE-SPECIFIC MEDIAN-SCALED");
    expect(output).toContain("Mean / median ordinal error");
    expect(output).toContain("CALIBRATION SUMMARY");
    expect(output).toContain("FINAL MEDIAN CALIBRATION DECISION");
    expect(output).toContain("Production preview unavailable");
    expect(output).toContain("Classes evaluation-only due insufficient support");
  });
});
