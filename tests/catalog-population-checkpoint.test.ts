import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CatalogCheckpointConfigurationMismatchError,
  loadCatalogPopulationCheckpoint,
  saveCatalogPopulationCheckpointAtomic,
} from "@/lib/catalog/catalog-population-checkpoint";
import {
  buildCatalogPopulationShards,
  buildCheckpointConfiguration,
  createCatalogPopulationCheckpoint,
  getActivePopulationGenres,
} from "@/lib/catalog/catalog-population-plan";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function checkpointFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "spodle-catalog-checkpoint-"));
  temporaryDirectories.push(directory);
  return join(directory, "checkpoint.json");
}

describe("catalog population checkpoint", () => {
  it("atomically persists and resumes the next offset", async () => {
    const file = await checkpointFile();
    const genres = getActivePopulationGenres().slice(0, 1);
    const shards = buildCatalogPopulationShards(2020, 2020, genres);
    const configuration = buildCheckpointConfiguration({ market: "US", yearFrom: 2020, yearTo: 2020 }, genres);
    const checkpoint = createCatalogPopulationCheckpoint(configuration, shards);
    checkpoint.shards["pop:2020"]!.nextOffset = 10;
    await saveCatalogPopulationCheckpointAtomic(file, checkpoint);
    checkpoint.shards["pop:2020"]!.nextOffset = 20;
    await saveCatalogPopulationCheckpointAtomic(file, checkpoint);

    const resumed = await loadCatalogPopulationCheckpoint(file, configuration, shards);
    expect(resumed.shards["pop:2020"]!.nextOffset).toBe(20);
    await expect(readFile(`${file}.${process.pid}.tmp`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses market, year, or genre configuration mismatches", async () => {
    const file = await checkpointFile();
    const genres = getActivePopulationGenres().slice(0, 1);
    const shards = buildCatalogPopulationShards(2020, 2020, genres);
    const us = buildCheckpointConfiguration({ market: "US", yearFrom: 2020, yearTo: 2020 }, genres);
    await saveCatalogPopulationCheckpointAtomic(file, createCatalogPopulationCheckpoint(us, shards));

    const pl = buildCheckpointConfiguration({ market: "PL", yearFrom: 2020, yearTo: 2020 }, genres);
    await expect(loadCatalogPopulationCheckpoint(file, pl, shards))
      .rejects.toBeInstanceOf(CatalogCheckpointConfigurationMismatchError);
    const changedYears = buildCheckpointConfiguration({ market: "US", yearFrom: 2019, yearTo: 2020 }, genres);
    const changedShards = buildCatalogPopulationShards(2019, 2020, genres);
    await expect(loadCatalogPopulationCheckpoint(file, changedYears, changedShards))
      .rejects.toBeInstanceOf(CatalogCheckpointConfigurationMismatchError);
    const changedGenres = getActivePopulationGenres().slice(0, 2);
    const changedGenreConfig = buildCheckpointConfiguration({
      market: "US", yearFrom: 2020, yearTo: 2020,
    }, changedGenres);
    const changedGenreShards = buildCatalogPopulationShards(2020, 2020, changedGenres);
    await expect(loadCatalogPopulationCheckpoint(file, changedGenreConfig, changedGenreShards))
      .rejects.toBeInstanceOf(CatalogCheckpointConfigurationMismatchError);
  });
});
