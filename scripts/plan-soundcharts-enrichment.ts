import "dotenv/config";
import { db } from "../src/lib/db";
import {
  executeSoundchartsEnrichmentPlanning,
  formatSoundchartsEnrichmentPlan,
  parseSoundchartsPlanningOptions,
} from "../src/lib/streams/enrichment-selection";

async function main(): Promise<void> {
  const options = parseSoundchartsPlanningOptions(process.argv.slice(2));
  const plan = await executeSoundchartsEnrichmentPlanning(options, {
    readTracks: () => db.gameTrack.findMany({
      orderBy: { spotifyTrackId: "asc" },
      select: {
        id: true,
        spotifyTrackId: true,
        isrc: true,
        title: true,
        artistNames: true,
        streamCount: true,
        streamCountSource: true,
        soundchartsUuid: true,
        difficulty: true,
        categories: { select: { categoryId: true } },
      },
    }),
  });
  console.log(formatSoundchartsEnrichmentPlan(plan, { verbose: options.verbose }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Soundcharts enrichment planning failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
