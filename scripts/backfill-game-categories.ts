import "dotenv/config";
import { db } from "../src/lib/db";
import {
  formatCategoryGameplayValidation,
  validateCategoryGameplayEligibility,
} from "../src/lib/catalog/category-game-eligibility";
import { parseStoredSoundchartsGenres } from "../src/lib/catalog/soundcharts-genre-mapping";

async function main(): Promise<void> {
  const storedTracks = await db.gameTrack.findMany({
    where: { soundchartsGenresJson: { not: null } },
    orderBy: { spotifyTrackId: "asc" },
    select: {
      id: true,
      title: true,
      artistNames: true,
      soundchartsGenresJson: true,
      categories: {
        select: {
          trackId: true,
          categoryId: true,
          gameEligible: true,
          gameEligibilitySource: true,
        },
      },
    },
  });
  const summary = await validateCategoryGameplayEligibility(
    storedTracks.map((track) => ({
      id: track.id,
      title: track.title,
      artistNames: track.artistNames,
      soundchartsGenres: parseStoredSoundchartsGenres(track.soundchartsGenresJson) ?? [],
      categories: track.categories,
    })),
    {
      updateRelation: async (trackId, categoryId, data) => {
        await db.trackCategory.update({
          where: { trackId_categoryId: { trackId, categoryId } },
          data,
        });
      },
    },
  );
  console.log(formatCategoryGameplayValidation(summary));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Category gameplay validation failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
