import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCatalogPopulationShards,
  buildCheckpointConfiguration,
  createCatalogPopulationCheckpoint,
  defaultCatalogPopulationOptions,
  getActivePopulationGenres,
  type CatalogPopulationCheckpoint,
  type CatalogPopulationOptions,
} from "@/lib/catalog/catalog-population-plan";
import {
  CATALOG_SPOTIFY_RETRY_OPTIONS,
  catalogSpotifySearchPath,
  executeCatalogPopulation,
  type CatalogPopulationDependencies,
} from "@/lib/catalog/catalog-populator";
import { SpotifyApiError, type SpotifySearchResponse, type SpotifyTrack } from "@/lib/spotify/api";

function spotifyTrack(id: string): SpotifyTrack {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: `Track ${id}`,
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
    artists: [{ id: `artist-${id}`, name: "Artist" }],
    album: { name: "Album", release_date: "2020" },
  };
}

function page(shard: string, offset: number, count = 10, next: string | null = "next"): SpotifySearchResponse {
  return {
    tracks: {
      items: Array.from({ length: count }, (_, index) => spotifyTrack(`${shard}-${offset + index}`)),
      next,
      total: 1_000,
    },
  };
}

describe("resumable catalog population", () => {
  let options: CatalogPopulationOptions;
  let checkpoint: CatalogPopulationCheckpoint;
  let dependencies: CatalogPopulationDependencies;
  let fetchPage: ReturnType<typeof vi.fn>;
  let upsertTrack: ReturnType<typeof vi.fn>;
  let saveCheckpoint: ReturnType<typeof vi.fn>;
  let getAccessToken: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    options = {
      ...defaultCatalogPopulationOptions(2026, "US"),
      yearFrom: 2020,
      yearTo: 2020,
      target: 20_000,
      maxRequests: 2,
      delayMs: 0,
    };
    const genres = getActivePopulationGenres();
    const shards = buildCatalogPopulationShards(2020, 2020, genres);
    checkpoint = createCatalogPopulationCheckpoint(buildCheckpointConfiguration(options, genres), shards);
    fetchPage = vi.fn(async ({ shard, offset }: { shard: { key: string }; offset: number }) => page(shard.key, offset));
    upsertTrack = vi.fn(async () => "created" as const);
    saveCheckpoint = vi.fn(async (next: CatalogPopulationCheckpoint) => { checkpoint = next; });
    getAccessToken = vi.fn(async () => "token");
    dependencies = {
      checkpointPath: ".runtime/catalog-populate-checkpoint.json",
      countTracks: vi.fn(async () => 1_000),
      loadCheckpoint: vi.fn(async () => checkpoint),
      resetCheckpoint: vi.fn(async () => undefined),
      saveCheckpoint,
      getAccessToken,
      fetchPage,
      upsertTrack,
      delay: vi.fn(async () => undefined),
    };
  });

  it("builds a ten-result genre/year request with importer-specific patient retries", () => {
    const shard = buildCatalogPopulationShards(1985, 1985, getActivePopulationGenres())[0]!;
    const path = catalogSpotifySearchPath(shard, 20, 10, "US");
    const params = new URL(`https://api.spotify.test${path}`).searchParams;
    expect(params.get("q")).toBe("genre:pop year:1985");
    expect(params.get("limit")).toBe("10");
    expect(params.get("offset")).toBe("20");
    expect(CATALOG_SPOTIFY_RETRY_OPTIONS).toEqual({ maxRetries: 5, maxRetryAfterSeconds: 300 });
  });

  it("honors the exact request budget and checkpoints each completed page", async () => {
    const result = await executeCatalogPopulation(options, dependencies);
    expect(result.mode).toBe("run");
    if (result.mode !== "run") return;
    expect(result.summary).toMatchObject({ reason: "request-budget", requests: 2, pagesCompleted: 2 });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(saveCheckpoint).toHaveBeenCalledTimes(2);
    expect(checkpoint.shards["pop:2020"]!.nextOffset).toBe(10);
    expect(checkpoint.shards["rock:2020"]!.nextOffset).toBe(10);
  });

  it("visits every offset-zero shard before returning to offset ten", async () => {
    options.maxRequests = 7;
    await executeCatalogPopulation(options, dependencies);
    expect(fetchPage.mock.calls.slice(0, 6).map(([input]) => [input.shard.key, input.offset])).toEqual([
      ["pop:2020", 0],
      ["rock:2020", 0],
      ["hip-hop:2020", 0],
      ["r-and-b:2020", 0],
      ["electronic:2020", 0],
      ["classical:2020", 0],
    ]);
    expect(fetchPage.mock.calls[6]?.[0]).toMatchObject({ shard: { key: "pop:2020" }, offset: 10 });
  });

  it("resumes without requesting an already checkpointed page again", async () => {
    options.maxRequests = 1;
    await executeCatalogPopulation(options, dependencies);
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({ shard: { key: "pop:2020" }, offset: 0 });

    await executeCatalogPopulation(options, dependencies);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1]?.[0]).toMatchObject({ shard: { key: "rock:2020" }, offset: 0 });
    expect(fetchPage.mock.calls.filter(([input]) => input.shard.key === "pop:2020" && input.offset === 0)).toHaveLength(1);
  });

  it("keeps Spotify-exhausted shards skipped on later runs", async () => {
    options.maxRequests = 1;
    fetchPage.mockImplementationOnce(async ({ shard, offset }) => page(shard.key, offset, 0, null));
    await executeCatalogPopulation(options, dependencies);
    expect(checkpoint.shards["pop:2020"]!.spotifyExhausted).toBe(true);

    await executeCatalogPopulation(options, dependencies);
    expect(fetchPage.mock.calls[1]?.[0]).toMatchObject({ shard: { key: "rock:2020" }, offset: 0 });
  });

  it("finishes an already-fetched page, then stops before another request at the global target", async () => {
    options.target = 1_001;
    dependencies.countTracks = vi.fn(async () => 1_000);
    const result = await executeCatalogPopulation(options, dependencies);
    expect(result.mode).toBe("run");
    if (result.mode !== "run") return;
    expect(result.summary).toMatchObject({ reason: "target-reached", requests: 1, tracksCreated: 10 });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(upsertTrack).toHaveBeenCalledTimes(10);
  });

  it("plan mode reads local state but obtains no token and performs no writes", async () => {
    options.plan = true;
    const result = await executeCatalogPopulation(options, dependencies);
    expect(result.mode).toBe("plan");
    if (result.mode !== "plan") return;
    expect(result.report).toContain("CATALOG POPULATION PLAN");
    expect(result.report).toContain("UPPER BOUND");
    expect(dependencies.countTracks).toHaveBeenCalledTimes(1);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchPage).not.toHaveBeenCalled();
    expect(upsertTrack).not.toHaveBeenCalled();
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });

  it("stops cleanly on QUOTA_EXCEEDED without advancing the checkpoint", async () => {
    fetchPage.mockRejectedValueOnce(new SpotifyApiError(429, "Quota exceeded", "QUOTA_EXCEEDED", null));
    const result = await executeCatalogPopulation(options, dependencies);
    expect(result.mode).toBe("run");
    if (result.mode !== "run") return;
    expect(result.summary).toMatchObject({ reason: "quota-exceeded", requests: 1, pagesCompleted: 0 });
    expect(result.summary.spotifyError).toMatchObject({ status: 429, reason: "QUOTA_EXCEEDED" });
    expect(checkpoint.shards["pop:2020"]!.nextOffset).toBe(0);
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });

  it("deduplicates identical Spotify IDs within a page before database work", async () => {
    options.maxRequests = 1;
    const duplicate = spotifyTrack("same-id");
    fetchPage.mockResolvedValueOnce({ tracks: { items: [duplicate, duplicate], next: null, total: 2 } });
    const result = await executeCatalogPopulation(options, dependencies);
    expect(result.mode).toBe("run");
    if (result.mode !== "run") return;
    expect(result.summary).toMatchObject({ spotifyRowsDiscovered: 2, uniquePageRowsProcessed: 1 });
    expect(upsertTrack).toHaveBeenCalledTimes(1);
  });
});
