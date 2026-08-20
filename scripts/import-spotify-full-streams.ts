import "dotenv/config";
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { db } from "../src/lib/db";
import { resolveDatasetFile } from "../src/lib/streams/data-file";
import {
  SpotifyFullImportAccumulator,
  formatSpotifyFullImportReport,
  updatesToApply,
  type SpotifyFullImportRow,
  type SpotifyFullImportTrack,
} from "../src/lib/streams/spotify-full-import";
import { STREAM_SOURCES } from "../src/lib/streams/stream-sources";

const UPDATE_BATCH_SIZE = 100;

async function main(): Promise<void> {
  const argumentsAfterCommand = process.argv.slice(2);
  const dryRun = argumentsAfterCommand.includes("--dry-run");
  const fileName = argumentsAfterCommand.find((argument) => argument !== "--dry-run");
  if (!fileName) throw new Error('Usage: npm run streams:import -- "spotify_full.csv" [--dry-run]');
  const input = await resolveDatasetFile(fileName);
  const rows = await db.gameTrack.findMany({
    select: {
      id: true,
      spotifyTrackId: true,
      streamCount: true,
      streamCountSource: true,
      difficulty: true,
    },
  });
  const localTracks = new Map<string, SpotifyFullImportTrack>(rows.map((row) => [row.spotifyTrackId, row]));
  const accumulator = new SpotifyFullImportAccumulator(localTracks);
  const parser = createReadStream(input.absolutePath).pipe(parse({
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }));
  for await (const row of parser) accumulator.consume(row as SpotifyFullImportRow);

  const plan = accumulator.plan();
  const importedAt = new Date();
  let actuallyUpdated = 0;
  const updates = updatesToApply(plan, dryRun);
  for (let offset = 0; offset < updates.length; offset += UPDATE_BATCH_SIZE) {
    const batch = updates.slice(offset, offset + UPDATE_BATCH_SIZE);
    const results = await db.$transaction(batch.map((update) => db.gameTrack.updateMany({
      where: {
        id: update.id,
        OR: [
          { streamCountSource: null },
          { streamCountSource: STREAM_SOURCES.provisionalSpotifyFull },
        ],
      },
      data: {
        streamCount: BigInt(update.streamCount),
        difficulty: update.difficulty,
        streamCountSource: STREAM_SOURCES.provisionalSpotifyFull,
        streamCountUpdatedAt: importedAt,
      },
    })));
    actuallyUpdated += results.reduce((total, result) => total + result.count, 0);
  }
  if (!dryRun) plan.updated = actuallyUpdated;
  console.log(formatSpotifyFullImportReport(plan, input.displayPath, { dryRun }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "spotify_full provisional import failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
