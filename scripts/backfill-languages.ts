import "dotenv/config";
import { db } from "../src/lib/db";
import { backfillTrackLanguages, formatLanguageBackfill } from "../src/lib/catalog/track-language";

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
  const summary = await backfillTrackLanguages(tracks, {
    updateTrack: async (id, state) => {
      await db.gameTrack.update({ where: { id }, data: state });
    },
  });
  console.log(formatLanguageBackfill(summary));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Language backfill failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
