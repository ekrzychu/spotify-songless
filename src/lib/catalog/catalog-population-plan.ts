import { CATEGORIES } from "@/lib/catalog/category-config";
import { SPOTIFY_MAX_SEARCH_OFFSET, SPOTIFY_SEARCH_LIMIT } from "@/lib/catalog/spotify-pagination";

export const CATALOG_CHECKPOINT_VERSION = 1 as const;
export const DEFAULT_CATALOG_TARGET = 20_000;
export const DEFAULT_CATALOG_YEAR_FROM = 1970;
export const DEFAULT_MAX_PER_SHARD = 100;
export const DEFAULT_MAX_REQUESTS = 500;
export const DEFAULT_REQUEST_DELAY_MS = 300;
export const DEFAULT_SPOTIFY_MARKET = "US";

export type CatalogPopulationOptions = {
  target: number;
  yearFrom: number;
  yearTo: number;
  maxPerShard: number;
  maxRequests: number;
  delayMs: number;
  market: string;
  plan: boolean;
  resetCheckpoint: boolean;
};

export type CatalogPopulationGenre = { id: string; label: string; query: string };

export type CatalogPopulationShard = {
  key: string;
  genreId: string;
  genreLabel: string;
  year: number;
  query: string;
};

export type CatalogCheckpointConfiguration = {
  market: string;
  yearFrom: number;
  yearTo: number;
  genres: Array<{ id: string; query: string }>;
};

export type CatalogShardCheckpoint = {
  nextOffset: number;
  spotifyExhausted: boolean;
};

export type CatalogPopulationCheckpoint = {
  version: typeof CATALOG_CHECKPOINT_VERSION;
  configuration: CatalogCheckpointConfiguration;
  shards: Record<string, CatalogShardCheckpoint>;
  updatedAt: string;
};

export class CatalogPopulationArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogPopulationArgumentError";
  }
}

export function getActivePopulationGenres(): CatalogPopulationGenre[] {
  return CATEGORIES
    .filter((category) => category.type === "genre" && category.spotifyQuery)
    .map((category) => ({ id: category.id, label: category.label, query: category.spotifyQuery! }));
}

export function defaultCatalogPopulationOptions(
  currentUtcYear = new Date().getUTCFullYear(),
  defaultMarket = process.env.SPOTIFY_MARKET ?? DEFAULT_SPOTIFY_MARKET,
): CatalogPopulationOptions {
  return {
    target: DEFAULT_CATALOG_TARGET,
    yearFrom: DEFAULT_CATALOG_YEAR_FROM,
    yearTo: currentUtcYear,
    maxPerShard: DEFAULT_MAX_PER_SHARD,
    maxRequests: DEFAULT_MAX_REQUESTS,
    delayMs: DEFAULT_REQUEST_DELAY_MS,
    market: normalizeMarket(defaultMarket),
    plan: false,
    resetCheckpoint: false,
  };
}

export function parseCatalogPopulationArgs(
  args: readonly string[],
  currentUtcYear = new Date().getUTCFullYear(),
  defaultMarket = process.env.SPOTIFY_MARKET ?? DEFAULT_SPOTIFY_MARKET,
): CatalogPopulationOptions {
  const options = defaultCatalogPopulationOptions(currentUtcYear, defaultMarket);

  for (const arg of args) {
    if (arg === "--plan") {
      options.plan = true;
      continue;
    }
    if (arg === "--reset-checkpoint") {
      options.resetCheckpoint = true;
      continue;
    }
    const separator = arg.indexOf("=");
    if (!arg.startsWith("--") || separator < 0) {
      throw new CatalogPopulationArgumentError(`Unknown or incomplete option: ${arg}`);
    }
    const name = arg.slice(2, separator);
    const value = arg.slice(separator + 1);
    switch (name) {
      case "target": options.target = parseInteger(name, value); break;
      case "year-from": options.yearFrom = parseInteger(name, value); break;
      case "year-to": options.yearTo = parseInteger(name, value); break;
      case "max-per-shard": options.maxPerShard = parseInteger(name, value); break;
      case "max-requests": options.maxRequests = parseInteger(name, value); break;
      case "delay-ms": options.delayMs = parseInteger(name, value); break;
      case "market": options.market = normalizeMarket(value); break;
      default: throw new CatalogPopulationArgumentError(`Unknown option: --${name}`);
    }
  }

  validateCatalogPopulationOptions(options, currentUtcYear);
  return options;
}

export function validateCatalogPopulationOptions(
  options: CatalogPopulationOptions,
  currentUtcYear = new Date().getUTCFullYear(),
): void {
  if (options.target < 0 || options.target > 1_000_000) {
    throw new CatalogPopulationArgumentError("--target must be between 0 and 1000000.");
  }
  if (options.yearFrom < 1900 || options.yearFrom > currentUtcYear) {
    throw new CatalogPopulationArgumentError(`--year-from must be between 1900 and ${currentUtcYear}.`);
  }
  if (options.yearTo < 1900 || options.yearTo > currentUtcYear) {
    throw new CatalogPopulationArgumentError(`--year-to must be between 1900 and ${currentUtcYear}.`);
  }
  if (options.yearFrom > options.yearTo) {
    throw new CatalogPopulationArgumentError("--year-from cannot be greater than --year-to.");
  }
  if (options.maxPerShard < 1 || options.maxPerShard > SPOTIFY_MAX_SEARCH_OFFSET) {
    throw new CatalogPopulationArgumentError(
      `--max-per-shard must be between 1 and ${SPOTIFY_MAX_SEARCH_OFFSET}.`,
    );
  }
  if (options.maxRequests < 0 || options.maxRequests > 100_000) {
    throw new CatalogPopulationArgumentError("--max-requests must be between 0 and 100000.");
  }
  if (options.delayMs < 0 || options.delayMs > 300_000) {
    throw new CatalogPopulationArgumentError("--delay-ms must be between 0 and 300000.");
  }
  normalizeMarket(options.market);
}

export function buildCatalogPopulationShards(
  yearFrom: number,
  yearTo: number,
  genres = getActivePopulationGenres(),
): CatalogPopulationShard[] {
  const shards: CatalogPopulationShard[] = [];
  for (const genre of genres) {
    for (let year = yearFrom; year <= yearTo; year += 1) {
      shards.push({
        key: `${genre.id}:${year}`,
        genreId: genre.id,
        genreLabel: genre.label,
        year,
        query: `${genre.query} year:${year}`,
      });
    }
  }
  return shards;
}

export function buildCheckpointConfiguration(
  options: Pick<CatalogPopulationOptions, "market" | "yearFrom" | "yearTo">,
  genres = getActivePopulationGenres(),
): CatalogCheckpointConfiguration {
  return {
    market: options.market,
    yearFrom: options.yearFrom,
    yearTo: options.yearTo,
    genres: genres.map(({ id, query }) => ({ id, query })),
  };
}

export function checkpointConfigurationFingerprint(configuration: CatalogCheckpointConfiguration): string {
  return JSON.stringify({
    market: configuration.market,
    yearFrom: configuration.yearFrom,
    yearTo: configuration.yearTo,
    genres: [...configuration.genres].sort((left, right) => left.id.localeCompare(right.id)),
    version: CATALOG_CHECKPOINT_VERSION,
  });
}

export function createCatalogPopulationCheckpoint(
  configuration: CatalogCheckpointConfiguration,
  shards: readonly CatalogPopulationShard[],
  updatedAt = new Date().toISOString(),
): CatalogPopulationCheckpoint {
  return {
    version: CATALOG_CHECKPOINT_VERSION,
    configuration,
    shards: Object.fromEntries(shards.map((shard) => [shard.key, { nextOffset: 0, spotifyExhausted: false }])),
    updatedAt,
  };
}

export function selectNextCatalogShard(
  shards: readonly CatalogPopulationShard[],
  checkpoint: CatalogPopulationCheckpoint,
  maxPerShard: number,
): CatalogPopulationShard | null {
  let selected: CatalogPopulationShard | null = null;
  let selectedOffset = Number.POSITIVE_INFINITY;
  for (const shard of shards) {
    const state = checkpoint.shards[shard.key];
    if (!state || state.spotifyExhausted || state.nextOffset >= maxPerShard) continue;
    if (state.nextOffset < selectedOffset) {
      selected = shard;
      selectedOffset = state.nextOffset;
    }
  }
  return selected;
}

export function catalogPlanMetrics(
  shards: readonly CatalogPopulationShard[],
  checkpoint: CatalogPopulationCheckpoint,
  maxPerShard: number,
): {
  pendingShards: number;
  spotifyExhaustedShards: number;
  locallyLimitedShards: number;
  nextMinimumOffset: number | null;
  upperBoundRequests: number;
} {
  const states = shards.map((shard) => checkpoint.shards[shard.key]!);
  const eligible = states.filter((state) => !state.spotifyExhausted && state.nextOffset < maxPerShard);
  return {
    pendingShards: eligible.length,
    spotifyExhaustedShards: states.filter((state) => state.spotifyExhausted).length,
    locallyLimitedShards: states.filter((state) => !state.spotifyExhausted && state.nextOffset >= maxPerShard).length,
    nextMinimumOffset: eligible.length ? Math.min(...eligible.map((state) => state.nextOffset)) : null,
    upperBoundRequests: shards.length * Math.ceil(maxPerShard / SPOTIFY_SEARCH_LIMIT),
  };
}

function parseInteger(name: string, value: string): number {
  if (!/^-?\d+$/.test(value)) throw new CatalogPopulationArgumentError(`--${name} must be an integer.`);
  return Number(value);
}

function normalizeMarket(value: string): string {
  const market = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(market)) {
    throw new CatalogPopulationArgumentError("--market must be a two-letter country code such as US or PL.");
  }
  return market;
}
