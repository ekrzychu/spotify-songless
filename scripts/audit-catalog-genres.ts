import "dotenv/config";
import { db } from "../src/lib/db";
import {
  executeCatalogGenreAudit,
  formatCatalogGenreAudit,
} from "../src/lib/catalog/catalog-genre-audit";

async function main(): Promise<void> {
  const audit = await executeCatalogGenreAudit({
    readTracks: () => db.gameTrack.findMany({
      orderBy: { spotifyTrackId: "asc" },
      select: {
        id: true,
        spotifyTrackId: true,
        title: true,
        artistNames: true,
        categories: { select: { categoryId: true } },
      },
    }),
  });
  console.log(formatCatalogGenreAudit(audit));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Catalog genre audit failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
