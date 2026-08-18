import "dotenv/config";
import { db } from "../src/lib/db";
import {
  backfillTrackLanguages,
  formatLanguageBackfill,
  type TrackLanguageState,
} from "../src/lib/catalog/track-language";

const WRITE_BATCH_SIZE = 500;

async function main(): Promise<void> {
  const tracks = await db.gameTrack.findMany({
    orderBy: { spotifyTrackId: "asc" },
    select: {
      id: true,
      spotifyTrackId: true,
      title: true,
      albumName: true,
      languageCode: true,
      languageSource: true,
      languageConfidence: true,
      languageEligible: true,
    },
  });
  const updates: Array<{
    id: string;
    state: TrackLanguageState & { languageUpdatedAt: Date };
  }> = [];
  const summary = await backfillTrackLanguages(tracks, {
    updateTrack: async (id, state) => {
      updates.push({ id, state });
    },
  });
  for (let offset = 0; offset < updates.length; offset += WRITE_BATCH_SIZE) {
    await db.$transaction(updates.slice(offset, offset + WRITE_BATCH_SIZE).map(({ id, state }) => (
      db.gameTrack.update({ where: { id }, data: state })
    )));
  }
  console.log(formatLanguageBackfill(summary));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Language backfill failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
