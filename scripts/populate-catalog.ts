import "dotenv/config";
import { CATEGORIES } from "../src/lib/catalog/category-config";
import { upsertCatalogTrack } from "../src/lib/catalog/catalog-service";
import {
  getClientCredentialsToken,
  spotifyFetch,
  type SpotifySearchResponse,
} from "../src/lib/spotify/api";
import { db } from "../src/lib/db";

const pagesPerCategory = Math.min(Math.max(Number(process.env.CATALOG_PAGES_PER_CATEGORY ?? 2), 1), 10);
const market = process.env.SPOTIFY_MARKET ?? "US";

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main(): Promise<void> {
  const token = await getClientCredentialsToken();
  let discovered = 0;
  let saved = 0;
  for (const category of CATEGORIES.filter((item) => item.spotifyQuery)) {
    process.stdout.write(`${category.label}: `);
    for (let page = 0; page < pagesPerCategory; page += 1) {
      const params = new URLSearchParams({
        q: category.spotifyQuery!, type: "track", limit: "50", offset: String(page * 50), market,
      });
      const response = await spotifyFetch<SpotifySearchResponse>(token, `/search?${params}`);
      discovered += response.tracks.items.length;
      for (const track of response.tracks.items) {
        await upsertCatalogTrack(track, category.id);
        saved += 1;
      }
      process.stdout.write(`${response.tracks.items.length}${page < pagesPerCategory - 1 ? "+" : ""}`);
      if (!response.tracks.next) break;
      await delay(150);
    }
    process.stdout.write(" tracks\n");
  }
  console.log(`\nCatalog population complete\nDiscovered: ${discovered}\nUpserted:   ${saved}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Catalog population failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
