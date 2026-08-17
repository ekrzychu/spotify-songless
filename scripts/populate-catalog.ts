import "dotenv/config";
import { upsertCatalogTrack } from "../src/lib/catalog/catalog-service";
import {
  CATALOG_POPULATION_CHECKPOINT_PATH,
  loadCatalogPopulationCheckpoint,
  resetCatalogPopulationCheckpoint,
  saveCatalogPopulationCheckpointAtomic,
} from "../src/lib/catalog/catalog-population-checkpoint";
import {
  CatalogPopulationArgumentError,
  parseCatalogPopulationArgs,
} from "../src/lib/catalog/catalog-population-plan";
import {
  CATALOG_SPOTIFY_RETRY_OPTIONS,
  CatalogPopulationRunError,
  catalogSpotifySearchPath,
  executeCatalogPopulation,
  formatCatalogPopulationSummary,
} from "../src/lib/catalog/catalog-populator";
import {
  getClientCredentialsToken,
  SpotifyApiError,
  spotifyFetch,
  type SpotifySearchResponse,
} from "../src/lib/spotify/api";
import { db } from "../src/lib/db";

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
let interruptionRequested = false;

function requestInterruption(signal: string): void {
  interruptionRequested = true;
  console.log(`\n${signal} received. Finishing the current page so its checkpoint remains consistent...`);
}

async function main(): Promise<void> {
  const options = parseCatalogPopulationArgs(process.argv.slice(2));
  const result = await executeCatalogPopulation(options, {
    checkpointPath: CATALOG_POPULATION_CHECKPOINT_PATH,
    countTracks: () => db.gameTrack.count(),
    loadCheckpoint: (configuration, shards) => loadCatalogPopulationCheckpoint(
      CATALOG_POPULATION_CHECKPOINT_PATH,
      configuration,
      shards,
    ),
    resetCheckpoint: () => resetCatalogPopulationCheckpoint(CATALOG_POPULATION_CHECKPOINT_PATH),
    saveCheckpoint: (checkpoint) => saveCatalogPopulationCheckpointAtomic(
      CATALOG_POPULATION_CHECKPOINT_PATH,
      checkpoint,
    ),
    getAccessToken: getClientCredentialsToken,
    fetchPage: async ({ token, shard, offset, limit, market }) => {
      return spotifyFetch<SpotifySearchResponse>(
        token,
        catalogSpotifySearchPath(shard, offset, limit, market),
        {},
        CATALOG_SPOTIFY_RETRY_OPTIONS,
      );
    },
    upsertTrack: upsertCatalogTrack,
    delay,
    shouldStop: () => interruptionRequested,
    onProgress: (summary) => console.log(
      `[progress] requests=${summary.requests} pages=${summary.pagesCompleted} created=${summary.tracksCreated} updated=${summary.tracksUpdated} total=${summary.currentTrackCount}`,
    ),
  });

  if (result.mode === "plan") {
    console.log(result.report);
    return;
  }

  console.log(formatCatalogPopulationSummary(result.summary, CATALOG_POPULATION_CHECKPOINT_PATH));
  if (["request-budget", "quota-exceeded", "interrupted"].includes(result.summary.reason)) {
    console.log(`\nContinue with the same command:\n${continuationCommand()}`);
  }
}

function continuationCommand(): string {
  const args = process.argv.slice(2).join(" ");
  return `npm run catalog:populate${args ? ` -- ${args}` : ""}`;
}

function printFailure(error: CatalogPopulationRunError): void {
  const cause = error.cause;
  const spotify = cause instanceof SpotifyApiError ? cause : null;
  console.error([
    "CATALOG POPULATION FAILED",
    `Message: ${error.message}`,
    `Last shard: ${error.summary.lastShard ?? "none"}`,
    `Last offset: ${error.summary.lastOffset ?? "none"}`,
    `Requests made this run: ${error.summary.requests}`,
    `Current catalog count: ${error.summary.currentTrackCount}`,
    `Checkpoint: ${CATALOG_POPULATION_CHECKPOINT_PATH}`,
    ...(spotify ? [
      `Spotify status: ${spotify.status}`,
      `Spotify reason: ${spotify.reason ?? "none"}`,
      `Spotify message: ${spotify.spotifyMessage ?? "none"}`,
    ] : []),
    "Progress through the last completed page is preserved.",
    `Rerun: ${continuationCommand()}`,
  ].join("\n"));
}

process.once("SIGINT", () => requestInterruption("SIGINT"));
process.once("SIGTERM", () => requestInterruption("SIGTERM"));

main()
  .catch((error: unknown) => {
    if (error instanceof CatalogPopulationRunError) printFailure(error);
    else if (error instanceof CatalogPopulationArgumentError) console.error(`Catalog options error: ${error.message}`);
    else console.error(error instanceof Error ? error.message : "Catalog population failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
