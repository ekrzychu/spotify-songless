import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  CATALOG_CHECKPOINT_VERSION,
  checkpointConfigurationFingerprint,
  createCatalogPopulationCheckpoint,
  type CatalogCheckpointConfiguration,
  type CatalogPopulationCheckpoint,
  type CatalogPopulationShard,
} from "@/lib/catalog/catalog-population-plan";

export const CATALOG_POPULATION_CHECKPOINT_PATH = resolve(
  process.cwd(),
  ".runtime/catalog-populate-checkpoint.json",
);

export class CatalogCheckpointConfigurationMismatchError extends Error {
  constructor(public readonly checkpointPath: string) {
    super(
      `Catalog checkpoint configuration does not match this run. Keep the existing run settings, or use --reset-checkpoint to intentionally start a new discovery checkpoint. Checkpoint: ${checkpointPath}`,
    );
    this.name = "CatalogCheckpointConfigurationMismatchError";
  }
}

export async function loadCatalogPopulationCheckpoint(
  checkpointPath: string,
  configuration: CatalogCheckpointConfiguration,
  shards: readonly CatalogPopulationShard[],
): Promise<CatalogPopulationCheckpoint> {
  let raw: string;
  try {
    raw = await readFile(checkpointPath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return createCatalogPopulationCheckpoint(configuration, shards);
    throw error;
  }

  const parsed = parseCheckpoint(raw, checkpointPath);
  if (
    parsed.version !== CATALOG_CHECKPOINT_VERSION
    || checkpointConfigurationFingerprint(parsed.configuration)
      !== checkpointConfigurationFingerprint(configuration)
  ) {
    throw new CatalogCheckpointConfigurationMismatchError(checkpointPath);
  }
  const expectedKeys = new Set(shards.map((shard) => shard.key));
  if (
    Object.keys(parsed.shards).length !== expectedKeys.size
    || Object.keys(parsed.shards).some((key) => !expectedKeys.has(key))
  ) {
    throw new CatalogCheckpointConfigurationMismatchError(checkpointPath);
  }
  return parsed;
}

export async function saveCatalogPopulationCheckpointAtomic(
  checkpointPath: string,
  checkpoint: CatalogPopulationCheckpoint,
): Promise<void> {
  await mkdir(dirname(checkpointPath), { recursive: true });
  const temporaryPath = `${checkpointPath}.${process.pid}.tmp`;
  const value = `${JSON.stringify({ ...checkpoint, updatedAt: new Date().toISOString() }, null, 2)}\n`;
  await writeFile(temporaryPath, value, { encoding: "utf8", flag: "w" });
  await rename(temporaryPath, checkpointPath);
}

export async function resetCatalogPopulationCheckpoint(checkpointPath: string): Promise<void> {
  await rm(checkpointPath, { force: true });
}

function parseCheckpoint(raw: string, checkpointPath: string): CatalogPopulationCheckpoint {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Catalog checkpoint is not valid JSON: ${checkpointPath}`);
  }
  if (!isCheckpoint(value)) throw new Error(`Catalog checkpoint has an invalid format: ${checkpointPath}`);
  return value;
}

function isCheckpoint(value: unknown): value is CatalogPopulationCheckpoint {
  if (!value || typeof value !== "object") return false;
  const checkpoint = value as Partial<CatalogPopulationCheckpoint>;
  const configuration = checkpoint.configuration as Partial<CatalogCheckpointConfiguration> | undefined;
  if (
    checkpoint.version !== CATALOG_CHECKPOINT_VERSION
    || !configuration
    || typeof configuration.market !== "string"
    || !Number.isInteger(configuration.yearFrom)
    || !Number.isInteger(configuration.yearTo)
    || !Array.isArray(configuration.genres)
    || !configuration.genres.every((genre) => Boolean(
      genre
      && typeof genre.id === "string"
      && typeof genre.query === "string",
    ))
    || !checkpoint.shards
    || typeof checkpoint.shards !== "object"
    || typeof checkpoint.updatedAt !== "string"
  ) return false;
  return Object.values(checkpoint.shards).every((state) => Boolean(
    state
    && Number.isInteger(state.nextOffset)
    && state.nextOffset >= 0
    && typeof state.spotifyExhausted === "boolean",
  ));
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
