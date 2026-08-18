import "dotenv/config";
import { db } from "../src/lib/db";
import {
  activeCatalogStatusCategories,
  formatCatalogStatus,
  type CatalogPoolStatus,
} from "../src/lib/catalog/catalog-status-report";
import { DIFFICULTIES, type Difficulty } from "../src/types/game";
import { isAcceptedGameLanguage } from "../src/lib/catalog/track-language";

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
    languageRows,
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
      languageEligible: true,
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
    db.gameTrack.findMany({ select: {
      languageCode: true,
      languageEligible: true,
      playable: true,
      gameEligible: true,
      streamCount: true,
      difficulty: true,
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
          languageEligible: true,
          difficulty: { not: null },
          streamCount: { not: null },
          categories: { some: { categoryId: category.id, gameEligible: true } },
        } }),
      ]);
      return { ...category, total, ranked, gameplayRanked };
    })),
  ]);
  const difficulty = Object.fromEntries(difficultyCounts) as Record<Difficulty, number>;
  const acceptedLanguageRows = languageRows.filter((track) => isAcceptedGameLanguage(track.languageCode));
  const classifiedAllowedRows = acceptedLanguageRows.filter((track) => track.languageCode !== null);
  const unclassifiedAcceptedRows = acceptedLanguageRows.filter((track) => track.languageCode === null);
  const languageByCode = languageRows.reduce<Record<string, number>>((counts, track) => {
    const code = track.languageCode ?? "unknown";
    counts[code] = (counts[code] ?? 0) + 1;
    return counts;
  }, {});

  console.log(formatCatalogStatus({
    totalTracks,
    playableTracks,
    gameEligibleTracks,
    gameIneligibleTracks,
    rankedTracks,
    gameplayRankedTracks,
    unrankedTracks: totalTracks - rankedTracks,
    language: {
      accepted: acceptedLanguageRows.length,
      classifiedAllowed: classifiedAllowedRows.length,
      unclassifiedAccepted: unclassifiedAcceptedRows.length,
      rejectedClassified: totalTracks - acceptedLanguageRows.length,
      acceptedRanked: acceptedLanguageRows.filter((track) => (
        track.languageEligible
        && track.playable && track.gameEligible && track.streamCount !== null && track.difficulty !== null
      )).length,
      byCode: languageByCode,
    },
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
