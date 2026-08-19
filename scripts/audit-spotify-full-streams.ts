import "dotenv/config";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse";
import { db } from "../src/lib/db";
import {
  SpotifyFullAuditAccumulator,
  formatSpotifyFullAudit,
  isRankedDifficulty,
  type LocalRankedTrack,
  type SpotifyFullRow,
} from "../src/lib/streams/spotify-full-audit";

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: npm run streams:audit:spotify-full -- C:\\path\\to\\spotify_full.csv");

  const rows = await db.gameTrack.findMany({
    where: {
      streamCount: { not: null },
      difficulty: { not: null },
    },
    select: {
      spotifyTrackId: true,
      streamCount: true,
      difficulty: true,
      streamCountSource: true,
      title: true,
      artistNames: true,
    },
  });
  const localTracks = new Map<string, LocalRankedTrack>();
  for (const row of rows) {
    const streamCount = Number(row.streamCount);
    if (!Number.isSafeInteger(streamCount) || streamCount < 0 || !isRankedDifficulty(row.difficulty!)) continue;
    localTracks.set(row.spotifyTrackId, {
      spotifyTrackId: row.spotifyTrackId,
      streamCount,
      difficulty: row.difficulty,
      streamCountSource: row.streamCountSource,
      title: row.title,
      artistNames: row.artistNames,
    });
  }

  const audit = new SpotifyFullAuditAccumulator(localTracks);
  const parser = createReadStream(resolve(input)).pipe(parse({
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }));
  for await (const row of parser) audit.consume(row as SpotifyFullRow);

  console.log(`Local ranked tracks indexed: ${localTracks.size}`);
  console.log(formatSpotifyFullAudit(audit.report()));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Spotify full stream audit failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
