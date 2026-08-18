import "dotenv/config";
import { db } from "../src/lib/db";
import {
  activeCatalogStatusCategories,
  formatCatalogStatus,
  type CatalogPoolStatus,
} from "../src/lib/catalog/catalog-status-report";
import { DIFFICULTIES, type Difficulty } from "../src/types/game";

async function main(): Promise<void> {
  const categories = activeCatalogStatusCategories();
  const [
    totalTracks,
    playableTracks,
    gameEligibleTracks,
    gameIneligibleTracks,
    rankedTracks,
    gameplayRankedTracks,
    difficultyCounts,
    allMusicRanked,
    pools,
  ] = await Promise.all([
    db.gameTrack.count(),
    db.gameTrack.count({ where: { playable: true } }),
    db.gameTrack.count({ where: { gameEligible: true } }),
    db.gameTrack.count({ where: { gameEligible: false } }),
    db.gameTrack.count({ where: { difficulty: { not: null }, streamCount: { not: null } } }),
    db.gameTrack.count({ where: {
      playable: true,
      gameEligible: true,
      difficulty: { not: null },
      streamCount: { not: null },
    } }),
    Promise.all(DIFFICULTIES.map(async (difficulty) => [
      difficulty,
      await db.gameTrack.count({ where: { difficulty, streamCount: { not: null } } }),
    ] as const)),
    db.gameTrack.count({ where: {
      playable: true,
      difficulty: { not: null },
      streamCount: { not: null },
    } }),
    Promise.all(categories.map(async (category): Promise<CatalogPoolStatus> => {
      const relation = { some: { categoryId: category.id } };
      const [total, ranked, gameplayRanked] = await Promise.all([
        db.gameTrack.count({ where: { playable: true, categories: relation } }),
        db.gameTrack.count({ where: {
          playable: true,
          difficulty: { not: null },
          streamCount: { not: null },
          categories: relation,
        } }),
        db.gameTrack.count({ where: {
          playable: true,
          gameEligible: true,
          difficulty: { not: null },
          streamCount: { not: null },
          categories: { some: { categoryId: category.id, gameEligible: true } },
        } }),
      ]);
      return { ...category, total, ranked, gameplayRanked };
    })),
  ]);
  const difficulty = Object.fromEntries(difficultyCounts) as Record<Difficulty, number>;

  console.log(formatCatalogStatus({
    totalTracks,
    playableTracks,
    gameEligibleTracks,
    gameIneligibleTracks,
    rankedTracks,
    gameplayRankedTracks,
    unrankedTracks: totalTracks - rankedTracks,
    difficulty,
    allMusic: { total: playableTracks, ranked: allMusicRanked },
    pools,
  }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Catalog status failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
