import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { db } from "../src/lib/db";
import { difficultyFromStreams } from "../src/lib/game/difficulty";
import {
  normalizeStreamRows,
  type RawStreamRow,
} from "../src/lib/streams/import-normalizer";

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: npm run import:streams -- ./data/streams.csv");
  const rawRows = parse(await readFile(resolve(input), "utf8"), {
    bom: true, columns: true, skip_empty_lines: true, trim: true,
  }) as RawStreamRow[];
  const normalized = normalizeStreamRows(rawRows);
  const summary = {
    read: rawRows.length, matched: 0, updated: 0, unchanged: 0,
    missing: 0, invalid: normalized.invalid, conflicts: normalized.conflicts,
  };

  for (const row of normalized.rows) {
    const track = row.spotifyTrackId
      ? await db.gameTrack.findUnique({ where: { spotifyTrackId: row.spotifyTrackId } })
      : await db.gameTrack.findFirst({ where: { isrc: row.isrc! } });
    const fallback = !track && row.isrc
      ? await db.gameTrack.findFirst({ where: { isrc: row.isrc } })
      : track;
    if (!fallback) {
      summary.missing += 1;
      continue;
    }
    summary.matched += 1;
    const difficulty = difficultyFromStreams(row.streamCount);
    if (
      fallback.streamCount !== BigInt(row.streamCount)
      || fallback.difficulty !== difficulty
      || fallback.streamCountSource !== "csv"
    ) {
      await db.gameTrack.update({
        where: { id: fallback.id },
        data: {
          streamCount: BigInt(row.streamCount),
          difficulty,
          streamCountSource: "csv",
          streamCountUpdatedAt: new Date(),
        },
      });
      summary.updated += 1;
    } else summary.unchanged += 1;
  }

  console.log([
    `Rows read: ${summary.read}`, `Matched:   ${summary.matched}`,
    `Updated:   ${summary.updated}`, `Unchanged: ${summary.unchanged}`,
    `Missing:   ${summary.missing}`, `Invalid:   ${summary.invalid}`, `Conflicts: ${summary.conflicts}`,
  ].join("\n"));
  if (summary.invalid > 0 || summary.conflicts > 0) process.exitCode = 2;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Stream import failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
