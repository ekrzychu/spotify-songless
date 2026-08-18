import "dotenv/config";
import { db } from "../src/lib/db";
import { RANKED_DIFFICULTY_LABELS } from "../src/lib/game/difficulty";
import {
  formatSoundchartsRequestTelemetry,
  SoundchartsApiError,
  SoundchartsClient,
  type SoundchartsErrorCode,
} from "../src/lib/soundcharts/client";
import {
  buildSoundchartsEnrichmentPlan,
  parseSoundchartsExecutionOptions,
  type PlannedEnrichmentGroup,
} from "../src/lib/streams/enrichment-selection";
import { enrichRecordingGroup } from "../src/lib/streams/soundcharts-enrichment";
import { recordSoundchartsNotFoundFailure } from "../src/lib/streams/soundcharts-not-found";
import { SoundchartsStreamCountProvider } from "../src/lib/streams/soundcharts-provider";

const DEFAULT_QUOTA_RESERVE = 50;

type StopReason =
  | "Completed selected groups"
  | "Quota reserve reached"
  | "Customer API request budget reached"
  | "Rate limited"
  | "Authentication failed"
  | "Forbidden"
  | "Unexpected API error";

type Summary = {
  selectedGroups: number;
  localTracksRepresented: number;
  completedGroups: number;
  resolvedBySpotify: number;
  resolvedByIsrc: number;
  cachedUuidUsed: number;
  updatedGroups: number;
  localTracksUpdated: number;
  audienceUnavailable: number;
  notFound: number;
  malformedResponses: number;
  errors: number;
  stopReason: StopReason;
};

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

function stopReasonFor(code: ReturnType<typeof errorCode>): StopReason | null {
  if (code === "quota_reserve") return "Quota reserve reached";
  if (code === "request_budget") return "Customer API request budget reached";
  if (code === "rate_limited") return "Rate limited";
  if (code === "authentication_failed" || code === "configuration") return "Authentication failed";
  if (code === "forbidden") return "Forbidden";
  if (code === "api_error" || code === "network_error" || code === "unexpected") return "Unexpected API error";
  return null;
}

function recordRecoverableError(summary: Summary, code: ReturnType<typeof errorCode>): string {
  if (code === "not_found") {
    summary.notFound += 1;
    return "NOT FOUND";
  }
  if (code === "malformed_response") {
    summary.malformedResponses += 1;
    return "MALFORMED RESPONSE";
  }
  summary.errors += 1;
  return code === "overflow" ? "AGGREGATED VALUE EXCEEDS SAFE INTEGER RANGE" : "ERROR";
}

function printGroupHeader(index: number, total: number, group: PlannedEnrichmentGroup): void {
  console.log(`[${index}/${total}] ${group.representative.title} - ${group.representative.artistNames}`);
  console.log(`Eligible target tracks represented: ${group.targetTrackIds.length}`);
  console.log(
    `Language: ${group.representative.languageCode ?? "unknown"}`
    + ` (${group.representative.languageSource ?? "unknown"})`,
  );
}

function printSummary(summary: Summary, client: SoundchartsClient): void {
  console.log([
    "\nSOUNDCHARTS ENRICHMENT",
    `Stop reason: ${summary.stopReason}`,
    `Selected recording groups: ${summary.selectedGroups}`,
    `Completed recording groups: ${summary.completedGroups}`,
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
    `Malformed responses: ${summary.malformedResponses}`,
    `Errors: ${summary.errors}`,
    "",
    formatSoundchartsRequestTelemetry(client.telemetry),
  ].join("\n"));
}

function shouldFailProcess(reason: StopReason): boolean {
  return ["Rate limited", "Authentication failed", "Forbidden", "Unexpected API error"].includes(reason);
}

function stopStatus(reason: StopReason): string {
  if (reason === "Quota reserve reached") return "STOPPED - QUOTA SAFETY RESERVE";
  if (reason === "Customer API request budget reached") return "STOPPED - CUSTOMER API REQUEST BUDGET";
  return `STOPPED - ${reason.toUpperCase()}`;
}

async function main(): Promise<void> {
  const options = parseSoundchartsExecutionOptions(process.argv.slice(2));
  const reserve = quotaReserve();
  const candidates = await db.gameTrack.findMany({
    orderBy: { spotifyTrackId: "asc" },
    select: {
      id: true,
      spotifyTrackId: true,
      isrc: true,
      title: true,
      artistNames: true,
      albumName: true,
      streamCount: true,
      streamCountSource: true,
      soundchartsUuid: true,
      soundchartsNotFoundAt: true,
      difficulty: true,
      playable: true,
      gameEligible: true,
      languageCode: true,
      languageSource: true,
      languageEligible: true,
      categories: { select: { categoryId: true, gameEligible: true } },
    },
  });
  const plan = buildSoundchartsEnrichmentPlan(candidates, options);
  const groups = plan.selectedGroups;
  const client = new SoundchartsClient({
    maxCustomerApiRequests: options.maxApiRequests,
    quotaReserve: reserve,
  });
  const provider = new SoundchartsStreamCountProvider(client, reserve);
  const summary: Summary = {
    selectedGroups: groups.length,
    localTracksRepresented: plan.localTracksRepresented,
    completedGroups: 0,
    resolvedBySpotify: 0,
    resolvedByIsrc: 0,
    cachedUuidUsed: 0,
    updatedGroups: 0,
    localTracksUpdated: 0,
    audienceUnavailable: 0,
    notFound: 0,
    malformedResponses: 0,
    errors: 0,
    stopReason: "Completed selected groups",
  };

  console.log([
    "SOUNDCHARTS ENRICHMENT",
    `Mode: ${options.canary ? "CANARY" : options.refresh ? "refresh Soundcharts-owned values and fill missing" : "fill missing only"}`,
    `Target per gameplay cell (reporting only): ${options.targetPerCell}`,
    `Include cached unranked: ${options.includeCachedUnranked ? "yes" : "no"}`,
    `Include previously not found: ${options.includeNotFound ? "yes" : "no"}`,
    `Include obvious non-song-like groups: ${options.includeNonSonglike ? "yes" : "no"}`,
    `Quota reserve: ${reserve}`,
    `Customer API request budget: ${options.maxApiRequests}`,
    `Selected recording groups: ${groups.length}`,
    "Selection order is neutral: represented targets, normalized ISRC, then stable key.",
    "Candidate difficulty is unknown until Soundcharts returns verified stream counts.",
  ].join("\n"));

  if (groups.length > 0) {
    try {
      await client.getAccessToken();
      for (const [offset, group] of groups.entries()) {
        printGroupHeader(offset + 1, groups.length, group);
        try {
          const result = await enrichRecordingGroup(group, provider, { refresh: options.refresh });
          summary.completedGroups += 1;
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
            console.log(`Difficulty: ${result.difficulty ? RANKED_DIFFICULTY_LABELS[result.difficulty] : "not assigned"}`);
            console.log(`Status: UPDATED (${result.localTracksUpdated} local track(s))`);
          } else {
            summary.audienceUnavailable += 1;
            console.log("Aggregated streams: not available");
            console.log("Difficulty: not assigned");
            console.log("Status: AUDIENCE UNAVAILABLE");
          }
        } catch (error) {
          await recordSoundchartsNotFoundFailure(error, group);
          const code = errorCode(error);
          const stopReason = stopReasonFor(code);
          if (stopReason) {
            summary.stopReason = stopReason;
            const detail = error instanceof SoundchartsApiError ? error.apiMessage : null;
            console.log(`Status: ${stopStatus(stopReason)}`);
            if (detail) console.log(`Soundcharts detail: ${detail}`);
            break;
          }
          console.log(`Status: ${recordRecoverableError(summary, code)}`);
        }
        console.log("");
      }
    } catch (error) {
      const code = errorCode(error);
      summary.stopReason = stopReasonFor(code) ?? "Unexpected API error";
      const detail = error instanceof SoundchartsApiError ? error.apiMessage : null;
      console.log(`Status: ${stopStatus(summary.stopReason)}`);
      if (detail) console.log(`Soundcharts detail: ${detail}`);
    }
  }

  if (shouldFailProcess(summary.stopReason)) process.exitCode = 1;
  printSummary(summary, client);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Soundcharts enrichment failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
