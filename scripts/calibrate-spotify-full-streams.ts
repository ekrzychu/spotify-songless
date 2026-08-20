import "dotenv/config";
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { db } from "../src/lib/db";
import { resolveDatasetFile } from "../src/lib/streams/data-file";
import {
  SpotifyFullCalibrationAccumulator,
  SpotifyFullPreviewAccumulator,
  buildProductionImpactPreview,
  filterProvisionalSpotifyFullTracks,
  filterSoundchartsReferenceTracks,
  formatSpotifyFullCalibration,
  type CalibrationCsvRow,
} from "../src/lib/streams/spotify-full-calibration";
import { STREAM_SOURCES } from "../src/lib/streams/stream-sources";

async function main(): Promise<void> {
  const fileName = process.argv[2];
  if (!fileName) throw new Error('Usage: npm run streams:calibrate -- "spotify_full.csv"');
  const input = await resolveDatasetFile(fileName);

  const select = {
    spotifyTrackId: true,
    streamCount: true,
    difficulty: true,
    streamCountSource: true,
    title: true,
    artistNames: true,
  } as const;
  const [soundchartsRows, provisionalRows] = await Promise.all([
    db.gameTrack.findMany({
      where: {
        streamCountSource: STREAM_SOURCES.verifiedSoundcharts,
        streamCount: { not: null },
        difficulty: { not: null },
      },
      select,
    }),
    db.gameTrack.findMany({
      where: {
        streamCountSource: STREAM_SOURCES.provisionalSpotifyFull,
        streamCount: { not: null },
        difficulty: { not: null },
      },
      select,
    }),
  ]);
  const references = filterSoundchartsReferenceTracks(soundchartsRows);
  const provisionalTracks = filterProvisionalSpotifyFullTracks(provisionalRows);
  const accumulator = new SpotifyFullCalibrationAccumulator(references);
  const previewAccumulator = new SpotifyFullPreviewAccumulator(new Set(provisionalTracks.keys()));
  const parser = createReadStream(input.absolutePath).pipe(parse({
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }));
  for await (const row of parser) {
    accumulator.consume(row as CalibrationCsvRow);
    previewAccumulator.consume(row as CalibrationCsvRow);
  }

  const report = accumulator.report();
  const preview = buildProductionImpactPreview(
    provisionalTracks,
    previewAccumulator.winningRows(),
    report.sourceSpecificMedian,
    report.medianDecision.scope,
  );
  console.log(formatSpotifyFullCalibration(report, input.displayPath, preview));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "spotify_full calibration failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
