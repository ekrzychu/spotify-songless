import "dotenv/config";
import { db } from "../src/lib/db";
import {
  buildSoundchartsMetadataAudit,
  formatSoundchartsMetadataAudit,
} from "../src/lib/catalog/soundcharts-metadata-audit";

async function main(): Promise<void> {
  const tracks = await db.gameTrack.findMany({
    where: {
      OR: [
        { soundchartsReleaseDate: { not: null } },
        { soundchartsGenresJson: { not: null } },
      ],
    },
    orderBy: { spotifyTrackId: "asc" },
    select: {
      id: true,
      spotifyTrackId: true,
      title: true,
      artistNames: true,
      releaseDate: true,
      soundchartsReleaseDate: true,
      soundchartsGenresJson: true,
      streamCount: true,
      categories: {
        select: {
          categoryId: true,
          gameEligible: true,
          gameEligibilitySource: true,
        },
      },
    },
  });
  console.log(formatSoundchartsMetadataAudit(buildSoundchartsMetadataAudit(tracks)));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Soundcharts metadata audit failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
