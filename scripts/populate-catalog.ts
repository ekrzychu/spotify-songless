import "dotenv/config";
import { CATEGORIES } from "../src/lib/catalog/category-config";
import { upsertCatalogTrack } from "../src/lib/catalog/catalog-service";
import {
  getClientCredentialsToken,
  spotifyFetch,
  type SpotifySearchResponse,
} from "../src/lib/spotify/api";
import { db } from "../src/lib/db";
import { paginateSpotifySearch } from "../src/lib/catalog/spotify-pagination";
import {
  backfillDerivedCategories,
  formatDecadeAssociationSummary,
} from "../src/lib/catalog/derived-categories";

const resultsPerCategory = Math.min(Math.max(Number(process.env.CATALOG_RESULTS_PER_CATEGORY ?? 100), 10), 500);
const market = process.env.SPOTIFY_MARKET ?? "US";

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main(): Promise<void> {
  const token = await getClientCredentialsToken();
  const total = { requests: 0, discovered: 0, created: 0, updated: 0 };
  const uniqueTrackIds = new Set<string>();
  for (const category of CATEGORIES.filter((item) => item.type === "genre" && item.spotifyQuery)) {
    const pageResult = await paginateSpotifySearch(async ({ offset, limit }) => {
      const params = new URLSearchParams({
        q: category.spotifyQuery!, type: "track", limit: String(limit), offset: String(offset), market,
      });
      const response = await spotifyFetch<SpotifySearchResponse>(token, `/search?${params}`);
      await delay(200);
      return response;
    }, resultsPerCategory);
    const uniqueCategoryTracks = [...new Map(pageResult.items.map((track) => [track.id, track])).values()];
    const categorySummary = { created: 0, updated: 0 };
    for (const track of uniqueCategoryTracks) {
      uniqueTrackIds.add(track.id);
      const action = await upsertCatalogTrack(track, category.id);
      categorySummary[action] += 1;
    }
    total.requests += pageResult.requests;
    total.discovered += pageResult.items.length;
    total.created += categorySummary.created;
    total.updated += categorySummary.updated;
    console.log([
      category.label,
      `  requests: ${pageResult.requests}`,
      `  discovered: ${pageResult.items.length}`,
      `  new: ${categorySummary.created}`,
      `  updated: ${categorySummary.updated}`,
    ].join("\n"));
  }
  console.log([
    "\nTOTAL", `Requests: ${total.requests}`, `Discovered: ${total.discovered}`,
    `Unique tracks: ${uniqueTrackIds.size}`, `Created: ${total.created}`, `Updated: ${total.updated}`,
  ].join("\n"));
  const decadeSummary = await backfillDerivedCategories();
  console.log(`\n${formatDecadeAssociationSummary(decadeSummary)}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Catalog population failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
