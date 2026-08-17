import { describe, expect, it } from "vitest";
import {
  buildCatalogPopulationShards,
  buildCheckpointConfiguration,
  catalogPlanMetrics,
  checkpointConfigurationFingerprint,
  createCatalogPopulationCheckpoint,
  defaultCatalogPopulationOptions,
  getActivePopulationGenres,
  parseCatalogPopulationArgs,
  selectNextCatalogShard,
} from "@/lib/catalog/catalog-population-plan";

describe("catalog population planning", () => {
  it("builds deterministic inclusive active-genre by year shards", () => {
    const genres = getActivePopulationGenres();
    const shards = buildCatalogPopulationShards(2020, 2021, genres);
    expect(genres.map((genre) => genre.id)).toEqual([
      "pop", "rock", "hip-hop", "r-and-b", "electronic", "classical",
    ]);
    expect(genres.map((genre) => genre.id)).not.toEqual(expect.arrayContaining([
      "indie", "metal", "punk", "country", "jazz",
    ]));
    expect(shards).toHaveLength(12);
    expect(shards[0]).toMatchObject({ key: "pop:2020", query: "genre:pop year:2020" });
    expect(shards[1]).toMatchObject({ key: "pop:2021", query: "genre:pop year:2021" });
    expect(shards.at(-1)).toMatchObject({ key: "classical:2021", query: "genre:classical year:2021" });
  });

  it("injects the current UTC year rather than hard-coding it", () => {
    expect(defaultCatalogPopulationOptions(2031, "pl")).toMatchObject({ yearTo: 2031, market: "PL" });
  });

  it("parses configurable CLI controls and rejects unsafe values", () => {
    expect(parseCatalogPopulationArgs([
      "--target=30000", "--year-from=1980", "--year-to=2025", "--max-per-shard=150",
      "--max-requests=1000", "--delay-ms=0", "--market=pl", "--plan", "--reset-checkpoint",
    ], 2026, "US")).toEqual({
      target: 30_000,
      yearFrom: 1980,
      yearTo: 2025,
      maxPerShard: 150,
      maxRequests: 1_000,
      delayMs: 0,
      market: "PL",
      plan: true,
      resetCheckpoint: true,
    });
    expect(() => parseCatalogPopulationArgs(["--target=-1"], 2026)).toThrow("--target");
    expect(() => parseCatalogPopulationArgs(["--year-from=2026", "--year-to=2025"], 2026)).toThrow("greater");
    expect(() => parseCatalogPopulationArgs(["--max-per-shard=1001"], 2026)).toThrow("1000");
    expect(() => parseCatalogPopulationArgs(["--delay-ms=-1"], 2026)).toThrow("--delay-ms");
  });

  it("schedules breadth-first by lowest offset with stable shard ordering", () => {
    const genres = getActivePopulationGenres().slice(0, 3);
    const shards = buildCatalogPopulationShards(2020, 2020, genres);
    const checkpoint = createCatalogPopulationCheckpoint(buildCheckpointConfiguration({
      market: "US", yearFrom: 2020, yearTo: 2020,
    }, genres), shards);
    checkpoint.shards["pop:2020"]!.nextOffset = 40;
    checkpoint.shards["rock:2020"]!.nextOffset = 20;
    checkpoint.shards["hip-hop:2020"]!.nextOffset = 20;

    expect(selectNextCatalogShard(shards, checkpoint, 100)?.key).toBe("rock:2020");
    checkpoint.shards["rock:2020"]!.spotifyExhausted = true;
    expect(selectNextCatalogShard(shards, checkpoint, 100)?.key).toBe("hip-hop:2020");
  });

  it("distinguishes a local depth limit from permanent Spotify exhaustion", () => {
    const genres = getActivePopulationGenres().slice(0, 1);
    const shards = buildCatalogPopulationShards(2020, 2020, genres);
    const checkpoint = createCatalogPopulationCheckpoint(buildCheckpointConfiguration({
      market: "US", yearFrom: 2020, yearTo: 2020,
    }, genres), shards);
    checkpoint.shards["pop:2020"] = { nextOffset: 100, spotifyExhausted: false };

    expect(selectNextCatalogShard(shards, checkpoint, 100)).toBeNull();
    expect(selectNextCatalogShard(shards, checkpoint, 150)?.key).toBe("pop:2020");
    expect(catalogPlanMetrics(shards, checkpoint, 100)).toMatchObject({
      pendingShards: 0,
      locallyLimitedShards: 1,
      spotifyExhaustedShards: 0,
    });
  });

  it("keeps run budgets and depth out of checkpoint identity", () => {
    const base = defaultCatalogPopulationOptions(2026, "US");
    const first = buildCheckpointConfiguration(base);
    const changedRunOptions = { ...base, target: 30_000, maxRequests: 1, maxPerShard: 150 };
    const second = buildCheckpointConfiguration(changedRunOptions);
    expect(checkpointConfigurationFingerprint(first)).toBe(checkpointConfigurationFingerprint(second));
    expect(checkpointConfigurationFingerprint(first)).not.toBe(checkpointConfigurationFingerprint({
      ...second,
      market: "PL",
    }));
  });
});
