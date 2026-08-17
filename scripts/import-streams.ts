import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { db } from "../src/lib/db";
import { difficultyFromStreams } from "../src/lib/game/difficulty";

type Row = { spotify_track_id?: string; isrc?: string; stream_count?: string };

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: npm run import:streams -- ./data/streams.csv");
  const rows = parse(await readFile(resolve(input), "utf8"), {
    columns: true, skip_empty_lines: true, trim: true,
  }) as Row[];
  const summary = { read: rows.length, matched: 0, updated: 0, missing: 0, invalid: 0 };

  for (const row of rows) {
    const count = Number(row.stream_count);
    const validId = !row.spotify_track_id || /^[A-Za-z0-9]{22}$/.test(row.spotify_track_id);
    if ((!row.spotify_track_id && !row.isrc) || !validId || !Number.isSafeInteger(count) || count < 0) {
      summary.invalid += 1;
      continue;
    }
    const track = row.spotify_track_id
      ? await db.gameTrack.findUnique({ where: { spotifyTrackId: row.spotify_track_id } })
      : await db.gameTrack.findFirst({ where: { isrc: normalizeIsrc(row.isrc!) } });
    const fallback = !track && row.isrc
      ? await db.gameTrack.findFirst({ where: { isrc: normalizeIsrc(row.isrc) } })
      : track;
    if (!fallback) {
      summary.missing += 1;
      continue;
    }
    summary.matched += 1;
    const difficulty = difficultyFromStreams(count);
    if (fallback.streamCount !== BigInt(count) || fallback.difficulty !== difficulty) {
      await db.gameTrack.update({
        where: { id: fallback.id }, data: { streamCount: BigInt(count), difficulty },
      });
      summary.updated += 1;
    }
  }

  console.log([
    `Rows read: ${summary.read}`, `Matched:   ${summary.matched}`,
    `Updated:   ${summary.updated}`, `Missing:   ${summary.missing}`, `Invalid:   ${summary.invalid}`,
  ].join("\n"));
  if (summary.invalid > 0) process.exitCode = 2;
}

function normalizeIsrc(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Stream import failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
