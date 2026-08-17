import { SpotifyApiError, type SpotifySearchResponse, type SpotifyTrack } from "@/lib/spotify/api";
import { SPOTIFY_SEARCH_LIMIT } from "@/lib/catalog/spotify-pagination";
import {
  buildCatalogPopulationShards,
  buildCheckpointConfiguration,
  catalogPlanMetrics,
  createCatalogPopulationCheckpoint,
  getActivePopulationGenres,
  selectNextCatalogShard,
  type CatalogCheckpointConfiguration,
  type CatalogPopulationCheckpoint,
  type CatalogPopulationOptions,
  type CatalogPopulationShard,
} from "@/lib/catalog/catalog-population-plan";

export const CATALOG_SPOTIFY_RETRY_OPTIONS = {
  maxRetries: 5,
  maxRetryAfterSeconds: 300,
} as const;

export function catalogSpotifySearchPath(
  shard: CatalogPopulationShard,
  offset: number,
  limit: number,
  market: string,
): string {
  const params = new URLSearchParams({
    q: shard.query,
    type: "track",
    limit: String(limit),
    offset: String(offset),
    market,
  });
  return `/search?${params}`;
}

export type CatalogPopulationStopReason =
  | "target-reached"
  | "request-budget"
  | "all-shards-complete"
  | "interrupted"
  | "quota-exceeded";

export type CatalogPopulationSummary = {
  reason: CatalogPopulationStopReason;
  requests: number;
  spotifyRowsDiscovered: number;
  uniquePageRowsProcessed: number;
  tracksCreated: number;
  tracksUpdated: number;
  currentTrackCount: number;
  pagesCompleted: number;
  shardsTouched: number;
  spotifyExhaustedShards: number;
  target: number;
  elapsedMs: number;
  lastShard: string | null;
  lastOffset: number | null;
  spotifyError?: { status: number; reason: string | null; message: string | null };
};

export type CatalogPopulationPlanResult = {
  mode: "plan";
  report: string;
  currentTrackCount: number;
  checkpoint: CatalogPopulationCheckpoint;
};

export type CatalogPopulationRunResult = {
  mode: "run";
  summary: CatalogPopulationSummary;
  checkpoint: CatalogPopulationCheckpoint;
};

export type CatalogPopulationCommandResult = CatalogPopulationPlanResult | CatalogPopulationRunResult;

export type CatalogPopulationDependencies = {
  checkpointPath: string;
  countTracks: () => Promise<number>;
  loadCheckpoint: (
    configuration: CatalogCheckpointConfiguration,
    shards: readonly CatalogPopulationShard[],
  ) => Promise<CatalogPopulationCheckpoint>;
  resetCheckpoint: () => Promise<void>;
  saveCheckpoint: (checkpoint: CatalogPopulationCheckpoint) => Promise<void>;
  getAccessToken: () => Promise<string>;
  fetchPage: (input: {
    token: string;
    shard: CatalogPopulationShard;
    offset: number;
    limit: number;
    market: string;
  }) => Promise<SpotifySearchResponse>;
  upsertTrack: (track: SpotifyTrack, genreId: string) => Promise<"created" | "updated">;
  delay: (milliseconds: number) => Promise<void>;
  shouldStop?: () => boolean;
  onProgress?: (summary: CatalogPopulationSummary) => void;
  now?: () => number;
};

export class CatalogPopulationRunError extends Error {
  constructor(
    public readonly summary: CatalogPopulationSummary,
    public override readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : "Catalog population failed", { cause });
    this.name = "CatalogPopulationRunError";
  }
}

export async function executeCatalogPopulation(
  options: CatalogPopulationOptions,
  dependencies: CatalogPopulationDependencies,
): Promise<CatalogPopulationCommandResult> {
  const genres = getActivePopulationGenres();
  const shards = buildCatalogPopulationShards(options.yearFrom, options.yearTo, genres);
  const configuration = buildCheckpointConfiguration(options, genres);

  let checkpoint: CatalogPopulationCheckpoint;
  if (options.plan && options.resetCheckpoint) {
    checkpoint = createCatalogPopulationCheckpoint(configuration, shards);
  } else {
    if (options.resetCheckpoint) await dependencies.resetCheckpoint();
    checkpoint = await dependencies.loadCheckpoint(configuration, shards);
  }
  const currentTrackCount = await dependencies.countTracks();

  if (options.plan) {
    return {
      mode: "plan",
      report: formatCatalogPopulationPlan(
        options,
        currentTrackCount,
        genres.length,
        shards,
        checkpoint,
        dependencies.checkpointPath,
      ),
      currentTrackCount,
      checkpoint,
    };
  }

  const startedAt = (dependencies.now ?? Date.now)();
  const initialReason = currentTrackCount >= options.target
    ? "target-reached"
    : options.maxRequests === 0 ? "request-budget" : null;
  if (initialReason) {
    return {
      mode: "run",
      checkpoint,
      summary: buildSummary(initialReason, currentTrackCount, options.target, checkpoint, startedAt, dependencies),
    };
  }

  const token = await dependencies.getAccessToken();
  return runCatalogPopulation(options, shards, checkpoint, token, currentTrackCount, startedAt, dependencies);
}

async function runCatalogPopulation(
  options: CatalogPopulationOptions,
  shards: readonly CatalogPopulationShard[],
  checkpoint: CatalogPopulationCheckpoint,
  token: string,
  initialTrackCount: number,
  startedAt: number,
  dependencies: CatalogPopulationDependencies,
): Promise<CatalogPopulationRunResult> {
  const counters = {
    requests: 0,
    spotifyRowsDiscovered: 0,
    uniquePageRowsProcessed: 0,
    tracksCreated: 0,
    tracksUpdated: 0,
    currentTrackCount: initialTrackCount,
    pagesCompleted: 0,
    touched: new Set<string>(),
    lastShard: null as string | null,
    lastOffset: null as number | null,
  };

  while (true) {
    const reason = stopReason(options, shards, checkpoint, counters, dependencies.shouldStop?.() ?? false);
    if (reason) return runResult(reason, checkpoint, options, counters, startedAt, dependencies);

    const shard = selectNextCatalogShard(shards, checkpoint, options.maxPerShard)!;
    const state = checkpoint.shards[shard.key]!;
    const offset = state.nextOffset;
    const limit = Math.min(SPOTIFY_SEARCH_LIMIT, options.maxPerShard - offset);
    counters.requests += 1;
    counters.lastShard = shard.key;
    counters.lastOffset = offset;

    let response: SpotifySearchResponse;
    try {
      response = await dependencies.fetchPage({ token, shard, offset, limit, market: options.market });
    } catch (error) {
      if (error instanceof SpotifyApiError && error.reason === "QUOTA_EXCEEDED") {
        return runResult("quota-exceeded", checkpoint, options, counters, startedAt, dependencies, error);
      }
      throw new CatalogPopulationRunError(
        buildSummaryFromCounters("interrupted", checkpoint, options, counters, startedAt, dependencies),
        error,
      );
    }

    const pageRows = response.tracks.items;
    const uniqueRows = [...new Map(pageRows.map((track) => [track.id, track])).values()];
    counters.spotifyRowsDiscovered += pageRows.length;
    counters.uniquePageRowsProcessed += uniqueRows.length;
    counters.touched.add(shard.key);

    try {
      for (const track of uniqueRows) {
        const action = await dependencies.upsertTrack(track, shard.genreId);
        counters[action === "created" ? "tracksCreated" : "tracksUpdated"] += 1;
        if (action === "created") counters.currentTrackCount += 1;
      }

      state.nextOffset = offset + pageRows.length;
      if (pageRows.length === 0 || !response.tracks.next) state.spotifyExhausted = true;
      counters.pagesCompleted += 1;
      await dependencies.saveCheckpoint(checkpoint);
    } catch (error) {
      throw new CatalogPopulationRunError(
        buildSummaryFromCounters("interrupted", checkpoint, options, counters, startedAt, dependencies),
        error,
      );
    }

    if (counters.requests % 25 === 0) {
      dependencies.onProgress?.(
        buildSummaryFromCounters("request-budget", checkpoint, options, counters, startedAt, dependencies),
      );
    }
    await dependencies.delay(options.delayMs);
  }
}

function stopReason(
  options: CatalogPopulationOptions,
  shards: readonly CatalogPopulationShard[],
  checkpoint: CatalogPopulationCheckpoint,
  counters: { requests: number; currentTrackCount: number },
  interrupted: boolean,
): CatalogPopulationStopReason | null {
  if (counters.currentTrackCount >= options.target) return "target-reached";
  if (interrupted) return "interrupted";
  if (counters.requests >= options.maxRequests) return "request-budget";
  if (!selectNextCatalogShard(shards, checkpoint, options.maxPerShard)) return "all-shards-complete";
  return null;
}

function runResult(
  reason: CatalogPopulationStopReason,
  checkpoint: CatalogPopulationCheckpoint,
  options: CatalogPopulationOptions,
  counters: {
    requests: number;
    spotifyRowsDiscovered: number;
    uniquePageRowsProcessed: number;
    tracksCreated: number;
    tracksUpdated: number;
    currentTrackCount: number;
    pagesCompleted: number;
    touched: Set<string>;
    lastShard: string | null;
    lastOffset: number | null;
  },
  startedAt: number,
  dependencies: CatalogPopulationDependencies,
  spotifyError?: SpotifyApiError,
): CatalogPopulationRunResult {
  return {
    mode: "run",
    checkpoint,
    summary: buildSummaryFromCounters(reason, checkpoint, options, counters, startedAt, dependencies, spotifyError),
  };
}

function buildSummaryFromCounters(
  reason: CatalogPopulationStopReason,
  checkpoint: CatalogPopulationCheckpoint,
  options: CatalogPopulationOptions,
  counters: {
    requests: number;
    spotifyRowsDiscovered: number;
    uniquePageRowsProcessed: number;
    tracksCreated: number;
    tracksUpdated: number;
    currentTrackCount: number;
    pagesCompleted: number;
    touched: Set<string>;
    lastShard: string | null;
    lastOffset: number | null;
  },
  startedAt: number,
  dependencies: CatalogPopulationDependencies,
  spotifyError?: SpotifyApiError,
): CatalogPopulationSummary {
  return {
    reason,
    requests: counters.requests,
    spotifyRowsDiscovered: counters.spotifyRowsDiscovered,
    uniquePageRowsProcessed: counters.uniquePageRowsProcessed,
    tracksCreated: counters.tracksCreated,
    tracksUpdated: counters.tracksUpdated,
    currentTrackCount: counters.currentTrackCount,
    pagesCompleted: counters.pagesCompleted,
    shardsTouched: counters.touched.size,
    spotifyExhaustedShards: Object.values(checkpoint.shards).filter((state) => state.spotifyExhausted).length,
    target: options.target,
    elapsedMs: Math.max(0, (dependencies.now ?? Date.now)() - startedAt),
    lastShard: counters.lastShard,
    lastOffset: counters.lastOffset,
    ...(spotifyError ? {
      spotifyError: {
        status: spotifyError.status,
        reason: spotifyError.reason,
        message: spotifyError.spotifyMessage,
      },
    } : {}),
  };
}

function buildSummary(
  reason: CatalogPopulationStopReason,
  currentTrackCount: number,
  target: number,
  checkpoint: CatalogPopulationCheckpoint,
  startedAt: number,
  dependencies: CatalogPopulationDependencies,
): CatalogPopulationSummary {
  return {
    reason,
    requests: 0,
    spotifyRowsDiscovered: 0,
    uniquePageRowsProcessed: 0,
    tracksCreated: 0,
    tracksUpdated: 0,
    currentTrackCount,
    pagesCompleted: 0,
    shardsTouched: 0,
    spotifyExhaustedShards: Object.values(checkpoint.shards).filter((state) => state.spotifyExhausted).length,
    target,
    elapsedMs: Math.max(0, (dependencies.now ?? Date.now)() - startedAt),
    lastShard: null,
    lastOffset: null,
  };
}

export function formatCatalogPopulationPlan(
  options: CatalogPopulationOptions,
  currentTrackCount: number,
  genreCount: number,
  shards: readonly CatalogPopulationShard[],
  checkpoint: CatalogPopulationCheckpoint,
  checkpointPath: string,
): string {
  const metrics = catalogPlanMetrics(shards, checkpoint, options.maxPerShard);
  return [
    "CATALOG POPULATION PLAN",
    "",
    `Current tracks: ${currentTrackCount.toLocaleString("en-US")}`,
    `Target tracks: ${options.target.toLocaleString("en-US")}`,
    "",
    `Genres: ${genreCount}`,
    `Years: ${options.yearFrom}-${options.yearTo}`,
    `Shards: ${shards.length}`,
    "",
    `Page size: ${SPOTIFY_SEARCH_LIMIT}`,
    `Max results per shard: ${options.maxPerShard}`,
    `Max requests this run: ${options.maxRequests}`,
    `Request delay: ${options.delayMs}ms`,
    `Market: ${options.market}`,
    "",
    "Checkpoint:",
    checkpointPath,
    "",
    `Pending shards: ${metrics.pendingShards}`,
    `Spotify-exhausted shards: ${metrics.spotifyExhaustedShards}`,
    `Locally depth-limited shards: ${metrics.locallyLimitedShards}`,
    `Next minimum offset: ${metrics.nextMinimumOffset ?? "none"}`,
    "",
    `UPPER BOUND requests at this depth: ${metrics.upperBoundRequests}`,
    "Actual requests may be lower because of target completion, exhausted Spotify pages, duplicates, or the per-run request budget.",
  ].join("\n");
}

export function formatCatalogPopulationSummary(summary: CatalogPopulationSummary, checkpointPath: string): string {
  const heading = summary.reason === "target-reached" ? "TARGET REACHED" : "CATALOG POPULATION RUN";
  const reason = {
    "target-reached": "Target reached",
    "request-budget": "Request budget reached; rerun the same command to continue",
    "all-shards-complete": "No eligible shards remain at the configured depth",
    interrupted: "Interrupted; progress through the last completed page is saved",
    "quota-exceeded": "Spotify quota exceeded; progress is preserved and the same command can be rerun later",
  }[summary.reason];
  return [
    heading,
    `Stop reason: ${reason}`,
    `Spotify requests this run: ${summary.requests}`,
    `Spotify rows discovered: ${summary.spotifyRowsDiscovered}`,
    `Unique page rows processed: ${summary.uniquePageRowsProcessed}`,
    `Tracks created: ${summary.tracksCreated}`,
    `Tracks updated: ${summary.tracksUpdated}`,
    `Current total DB tracks: ${summary.currentTrackCount}`,
    `Pages completed: ${summary.pagesCompleted}`,
    `Shards touched: ${summary.shardsTouched}`,
    `Shards Spotify-exhausted: ${summary.spotifyExhaustedShards}`,
    `Target: ${summary.target}`,
    `Last shard: ${summary.lastShard ?? "none"}`,
    `Last offset: ${summary.lastOffset ?? "none"}`,
    `Checkpoint: ${checkpointPath}`,
    `Elapsed: ${(summary.elapsedMs / 1000).toFixed(1)}s`,
    ...(summary.spotifyError ? [
      `Spotify status: ${summary.spotifyError.status}`,
      `Spotify reason: ${summary.spotifyError.reason ?? "none"}`,
      `Spotify message: ${summary.spotifyError.message ?? "none"}`,
    ] : []),
  ].join("\n");
}
