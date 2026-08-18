import "dotenv/config";
import { db } from "../src/lib/db";
import {
  backfillGameEligibility,
  formatGameEligibilityBackfill,
} from "../src/lib/catalog/game-eligibility";

async function main(): Promise<void> {
  const summary = await backfillGameEligibility({
    readTracks: () => db.gameTrack.findMany({
      select: { id: true, title: true, gameEligible: true },
      orderBy: { spotifyTrackId: "asc" },
    }),
    updateEligibility: async (id, gameEligible) => {
      await db.gameTrack.update({ where: { id }, data: { gameEligible } });
    },
  });
  console.log(formatGameEligibilityBackfill(summary));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Game eligibility backfill failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
