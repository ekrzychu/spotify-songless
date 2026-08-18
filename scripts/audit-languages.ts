import "dotenv/config";
import { db } from "../src/lib/db";
import { buildLanguageAudit, formatLanguageAudit } from "../src/lib/catalog/language-audit";

async function main(): Promise<void> {
  const tracks = await db.gameTrack.findMany({
    orderBy: { spotifyTrackId: "asc" },
    select: {
      spotifyTrackId: true,
      title: true,
      artistNames: true,
      languageCode: true,
      languageSource: true,
      languageConfidence: true,
      languageEligible: true,
    },
  });
  console.log(formatLanguageAudit(buildLanguageAudit(tracks)));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Language audit failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
