import "dotenv/config";
import { CATEGORIES } from "../src/lib/catalog/category-config";
import { db } from "../src/lib/db";
import { DIFFICULTY_LABELS } from "../src/lib/game/difficulty";
import { SoundchartsApiError, SoundchartsClient, type SoundchartsErrorCode } from "../src/lib/soundcharts/client";
import {
  selectBalancedEnrichmentGroups,
  type EnrichmentRecordingGroup,
} from "../src/lib/streams/enrichment-selection";
import { enrichRecordingGroup } from "../src/lib/streams/soundcharts-enrichment";
import { SoundchartsStreamCountProvider } from "../src/lib/streams/soundcharts-provider";
import type { Difficulty } from "../src/types/game";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 400;
const DEFAULT_QUOTA_RESERVE = 50;

type Options = { limit: number; refresh: boolean };

type Summary = {
  selectedGroups: number;
  localTracksRepresented: number;
  resolvedBySpotify: number;
  resolvedByIsrc: number;
  cachedUuidUsed: number;
  updatedGroups: number;
  localTracksUpdated: number;
  audienceUnavailable: number;
  notFound: number;
  authenticationFailed: number;
  forbidden: number;
  rateLimited: number;
  quotaSafetyStops: number;
  errors: number;
};

function parseOptions(args: string[]): Options {
  const inline = args.find((argument) => argument.startsWith("--limit="));
  const index = args.indexOf("--limit");
  const rawLimit = inline?.slice("--limit=".length) ?? (index >= 0 ? args[index + 1] : undefined);
  const parsedLimit = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    throw new Error("Usage: npm run streams:enrich:soundcharts -- --limit 100 [--refresh]");
  }
  return { limit: Math.min(parsedLimit, MAX_LIMIT), refresh: args.includes("--refresh") };
}

function quotaReserve(): number {
  const configured = Number(process.env.SOUNDCHARTS_QUOTA_RESERVE ?? DEFAULT_QUOTA_RESERVE);
  if (!Number.isSafeInteger(configured) || configured < 0) {
    throw new Error("SOUNDCHARTS_QUOTA_RESERVE must be a non-negative integer");
  }
  return configured;
}

function errorCode(error: unknown): SoundchartsErrorCode | "overflow" | "unexpected" {
  if (error instanceof SoundchartsApiError) return error.code;
  if (error instanceof RangeError) return "overflow";
  return "unexpected";
}

function recordError(summary: Summary, code: ReturnType<typeof errorCode>): string {
  if (code === "authentication_failed" || code === "configuration") {
    summary.authenticationFailed += 1;
    return "AUTHENTICATION FAILED";
  }
  if (code === "forbidden") {
    summary.forbidden += 1;
    return "FORBIDDEN — ENDPOINT NOT IN PLAN";
  }
  if (code === "rate_limited") {
    summary.rateLimited += 1;
    return "RATE LIMITED";
  }
  if (code === "quota_reserve") {
    summary.quotaSafetyStops += 1;
    return "STOPPED — QUOTA SAFETY RESERVE";
  }
  if (code === "not_found") {
    summary.notFound += 1;
    return "NOT FOUND";
  }
  summary.errors += 1;
  if (code === "malformed_response") return "MALFORMED RESPONSE";
  if (code === "overflow") return "AGGREGATED VALUE EXCEEDS SAFE INTEGER RANGE";
  return "ERROR";
}

function isSystemic(code: ReturnType<typeof errorCode>): boolean {
  return code !== "not_found" && code !== "malformed_response" && code !== "overflow";
}

function printGroupHeader(index: number, total: number, group: EnrichmentRecordingGroup): void {
  console.log(`[${index}/${total}] ${group.representative.title} — ${group.representative.artistNames}`);
  console.log(`Local tracks represented: ${group.targetTrackIds.length}`);
}

function printSummary(summary: Summary, client: SoundchartsClient): void {
  console.log([
    "\nSOUNDCHARTS ENRICHMENT",
    `Selected recording groups: ${summary.selectedGroups}`,
    `Local tracks represented: ${summary.localTracksRepresented}`,
    "",
    `Resolved by Spotify ID: ${summary.resolvedBySpotify}`,
    `Resolved by ISRC: ${summary.resolvedByIsrc}`,
    `Cached UUID used: ${summary.cachedUuidUsed}`,
    "",
    `Updated recording groups: ${summary.updatedGroups}`,
    `Local tracks updated: ${summary.localTracksUpdated}`,
    `Audience unavailable: ${summary.audienceUnavailable}`,
    `Not found: ${summary.notFound}`,
    `Authentication failed: ${summary.authenticationFailed}`,
    `Forbidden: ${summary.forbidden}`,
    `Rate limited: ${summary.rateLimited}`,
    `Quota safety stops: ${summary.quotaSafetyStops}`,
    `Errors: ${summary.errors}`,
    "",
    `API requests made (including token and free quota monitor): ${client.requestCount}`,
    `Quota remaining: ${client.quotaRemaining ?? "not reported"}`,
  ].join("\n"));
}

async function printCatalogDistribution(): Promise<void> {
  const tracks = await db.gameTrack.findMany({
    select: { difficulty: true, categories: { select: { categoryId: true } } },
  });
  const difficultyCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  for (const track of tracks) {
    const difficulty = track.difficulty ?? "unranked";
    difficultyCounts.set(difficulty, (difficultyCounts.get(difficulty) ?? 0) + 1);
    if (track.difficulty) {
      for (const category of track.categories) {
        categoryCounts.set(category.categoryId, (categoryCounts.get(category.categoryId) ?? 0) + 1);
      }
    }
  }

  const difficultyOrder: Difficulty[] = ["easy", "normal", "hard", "extreme", "impossible"];
  console.log("\nCURRENT DIFFICULTY DISTRIBUTION");
  for (const difficulty of difficultyOrder) {
    console.log(`${DIFFICULTY_LABELS[difficulty]}: ${difficultyCounts.get(difficulty) ?? 0}`);
  }
  console.log(`Unranked: ${difficultyCounts.get("unranked") ?? 0}`);

  for (const type of ["genre", "decade"] as const) {
    console.log(`\nRANKED TRACKS BY ${type.toUpperCase()}`);
    for (const category of CATEGORIES.filter((item) => item.type === type)) {
      console.log(`${category.label}: ${categoryCounts.get(category.id) ?? 0}`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const reserve = quotaReserve();
  const candidates = await db.gameTrack.findMany({
    orderBy: { spotifyTrackId: "asc" },
    select: {
      id: true,
      spotifyTrackId: true,
      isrc: true,
      title: true,
      artistNames: true,
      streamCount: true,
      streamCountSource: true,
      soundchartsUuid: true,
      categories: { select: { categoryId: true } },
    },
  });
  const groups = selectBalancedEnrichmentGroups(candidates, options.limit, options.refresh);
  const client = new SoundchartsClient();
  const provider = new SoundchartsStreamCountProvider(client, reserve);
  const summary: Summary = {
    selectedGroups: groups.length,
    localTracksRepresented: groups.reduce((total, group) => total + group.targetTrackIds.length, 0),
    resolvedBySpotify: 0,
    resolvedByIsrc: 0,
    cachedUuidUsed: 0,
    updatedGroups: 0,
    localTracksUpdated: 0,
    audienceUnavailable: 0,
    notFound: 0,
    authenticationFailed: 0,
    forbidden: 0,
    rateLimited: 0,
    quotaSafetyStops: 0,
    errors: 0,
  };

  console.log([
    "SOUNDCHARTS ENRICHMENT",
    `Mode: ${options.refresh ? "refresh existing Soundcharts values and fill missing" : "fill missing only"}`,
    `Quota reserve: ${reserve}`,
    `Selected recording groups: ${groups.length}`,
  ].join("\n"));

  try {
    await client.getAccessToken();
    try {
      await client.refreshQuotaRemaining();
    } catch (error) {
      if (!(error instanceof SoundchartsApiError) || error.code !== "forbidden") throw error;
      console.log("Quota monitor: unavailable for this plan; using response headers.");
    }
    if (client.quotaRemaining !== null && client.quotaRemaining <= reserve) {
      summary.quotaSafetyStops += 1;
      console.log("Stopped before enrichment: quota safety reserve reached.");
    } else {
      for (const [offset, group] of groups.entries()) {
        printGroupHeader(offset + 1, groups.length, group);
        if (group.hasConflictingCachedUuids) {
          summary.errors += 1;
          console.log("Status: SKIPPED — CONFLICTING CACHED SOUNDCHARTS UUIDS\n");
          continue;
        }
        try {
          const result = await enrichRecordingGroup(group, provider, { refresh: options.refresh });
          if (result.providerResult.resolutionSource === "spotify") summary.resolvedBySpotify += 1;
          else if (result.providerResult.resolutionSource === "isrc") summary.resolvedByIsrc += 1;
          else summary.cachedUuidUsed += 1;

          console.log(`Soundcharts UUID: ${result.providerResult.soundchartsUuid}`);
          console.log(`Spotify identifiers: ${result.providerResult.identifierCount}`);
          console.log(`Unique stream totals: ${result.providerResult.uniqueValueCount}`);
          if (result.status === "updated") {
            summary.updatedGroups += 1;
            summary.localTracksUpdated += result.localTracksUpdated;
            console.log(`Aggregated streams: ${result.providerResult.streamCount!.toLocaleString("en-US")}`);
            console.log(`Difficulty: ${result.difficulty ? DIFFICULTY_LABELS[result.difficulty] : "not assigned"}`);
            console.log(`Status: UPDATED (${result.localTracksUpdated} local track(s))`);
          } else {
            summary.audienceUnavailable += 1;
            console.log("Aggregated streams: not available");
            console.log("Difficulty: not assigned");
            console.log("Status: AUDIENCE UNAVAILABLE");
          }
        } catch (error) {
          const code = errorCode(error);
          console.log(`Status: ${recordError(summary, code)}`);
          if (isSystemic(code)) {
            process.exitCode = 1;
            console.log("");
            break;
          }
        }
        console.log("");
        if (client.quotaRemaining !== null && client.quotaRemaining <= reserve) {
          summary.quotaSafetyStops += 1;
          console.log("Stopped: quota safety reserve reached.");
          break;
        }
      }
    }
  } catch (error) {
    const code = errorCode(error);
    console.log(`Status: ${recordError(summary, code)}`);
    process.exitCode = 1;
  }

  printSummary(summary, client);
  await printCatalogDistribution();
}

main()
  .catch(() => {
    console.error("Soundcharts enrichment failed. If the schema is new, run npm run db:push first.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
