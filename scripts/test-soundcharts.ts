import "dotenv/config";
import { db } from "../src/lib/db";
import {
  SoundchartsApiError,
  SoundchartsClient,
  type SoundchartsErrorCode,
  type SpotifyAudiencePoint,
} from "../src/lib/soundcharts/client";

const MAX_TRACKS = 10;

type DiagnosticTrack = {
  spotifyTrackId: string;
  isrc: string | null;
  title: string;
  artistNames: string;
};

type Summary = {
  selected: number;
  tested: number;
  resolved: number;
  audienceAvailable: number;
  audienceUnavailable: number;
  notFound: number;
  authenticationFailed: number;
  forbidden: number;
  rateLimited: number;
  otherErrors: number;
};

function parseLimit(args: string[]): number {
  const inline = args.find((argument) => argument.startsWith("--limit="));
  const index = args.indexOf("--limit");
  const raw = inline?.slice("--limit=".length) ?? (index >= 0 ? args[index + 1] : undefined);
  if (raw === undefined) return MAX_TRACKS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Usage: npm run soundcharts:test -- --limit 5");
  }
  return Math.min(parsed, MAX_TRACKS);
}

async function resolveSong(
  client: SoundchartsClient,
  track: DiagnosticTrack,
): Promise<{ uuid: string; source: "Spotify ID" | "ISRC" }> {
  try {
    return { uuid: await client.getSongBySpotifyId(track.spotifyTrackId), source: "Spotify ID" };
  } catch (error) {
    if (!(error instanceof SoundchartsApiError) || error.code !== "not_found" || !track.isrc) throw error;
    return { uuid: await client.getSongByIsrc(track.isrc), source: "ISRC" };
  }
}

function safeErrorCode(error: unknown): SoundchartsErrorCode | "unexpected" {
  return error instanceof SoundchartsApiError ? error.code : "unexpected";
}

function recordError(summary: Summary, code: SoundchartsErrorCode | "unexpected"): string {
  if (code === "authentication_failed" || code === "configuration") {
    summary.authenticationFailed += 1;
    return code === "configuration" ? "CREDENTIALS NOT CONFIGURED" : "AUTHENTICATION FAILED";
  }
  if (code === "forbidden") {
    summary.forbidden += 1;
    return "FORBIDDEN — ENDPOINT NOT IN PLAN";
  }
  if (code === "not_found") {
    summary.notFound += 1;
    return "NOT FOUND";
  }
  if (code === "rate_limited") {
    summary.rateLimited += 1;
    return "RATE LIMITED";
  }
  summary.otherErrors += 1;
  return code === "malformed_response" ? "MALFORMED RESPONSE" : "ERROR";
}

function shouldStopBatch(code: SoundchartsErrorCode | "unexpected"): boolean {
  return code !== "not_found";
}

function printTrack(
  index: number,
  track: DiagnosticTrack,
  soundchartsUuid: string | null,
  audience: SpotifyAudiencePoint | null,
  status: string,
  resolutionSource: string | null,
): void {
  console.log([
    `${index}. ${track.title} — ${track.artistNames}`,
    `   Spotify ID: ${track.spotifyTrackId}`,
    `   ISRC: ${track.isrc ?? "not available"}`,
    `   Soundcharts UUID: ${soundchartsUuid ?? "not resolved"}`,
    `   Resolved by: ${resolutionSource ?? "n/a"}`,
    `   Latest audience date: ${audience?.date.slice(0, 10) ?? "not available"}`,
    `   Spotify streams: ${audience ? audience.streams.toLocaleString("en-US") : "not available"}`,
    `   Status: ${status}`,
  ].join("\n"));
}

function printSummary(summary: Summary, requestCount: number): void {
  console.log([
    "\nSUMMARY",
    `Tracks selected: ${summary.selected}`,
    `Tracks tested: ${summary.tested}`,
    `Resolved: ${summary.resolved}`,
    `Audience available: ${summary.audienceAvailable}`,
    `Audience unavailable: ${summary.audienceUnavailable}`,
    `Not found: ${summary.notFound}`,
    `Authentication failed: ${summary.authenticationFailed}`,
    `Forbidden: ${summary.forbidden}`,
    `Rate limited: ${summary.rateLimited}`,
    `Other errors: ${summary.otherErrors}`,
    `API requests made (including token): ${requestCount}`,
  ].join("\n"));
}

async function main(): Promise<void> {
  const limit = parseLimit(process.argv.slice(2));
  const tracks = await db.gameTrack.findMany({
    where: { streamCount: null },
    orderBy: [{ isrc: "desc" }, { spotifyTrackId: "asc" }],
    take: limit,
    select: { spotifyTrackId: true, isrc: true, title: true, artistNames: true },
  });
  const client = new SoundchartsClient();
  const summary: Summary = {
    selected: tracks.length,
    tested: 0,
    resolved: 0,
    audienceAvailable: 0,
    audienceUnavailable: 0,
    notFound: 0,
    authenticationFailed: 0,
    forbidden: 0,
    rateLimited: 0,
    otherErrors: 0,
  };

  console.log("SOUNDCHARTS TEST\n");
  try {
    await client.getAccessToken();
  } catch (error) {
    const code = safeErrorCode(error);
    console.log(`Authentication status: ${recordError(summary, code)}`);
    printSummary(summary, client.requestCount);
    process.exitCode = 1;
    return;
  }

  for (const [offset, track] of tracks.entries()) {
    summary.tested += 1;
    let soundchartsUuid: string | null = null;
    let resolutionSource: "Spotify ID" | "ISRC" | null = null;
    try {
      const resolution = await resolveSong(client, track);
      soundchartsUuid = resolution.uuid;
      resolutionSource = resolution.source;
      summary.resolved += 1;
      const audience = await client.getLatestSpotifyAudience(soundchartsUuid, track.spotifyTrackId);
      if (audience) summary.audienceAvailable += 1;
      else summary.audienceUnavailable += 1;
      printTrack(
        offset + 1,
        track,
        soundchartsUuid,
        audience,
        audience ? "OK — CUMULATIVE SPOTIFY STREAM COUNT" : "AUDIENCE UNAVAILABLE",
        resolutionSource,
      );
    } catch (error) {
      const code = safeErrorCode(error);
      printTrack(offset + 1, track, soundchartsUuid, null, recordError(summary, code), resolutionSource);
      if (shouldStopBatch(code)) {
        process.exitCode = 1;
        break;
      }
    }
    console.log("");
  }

  printSummary(summary, client.requestCount);
}

main()
  .catch(() => {
    console.error("Soundcharts diagnostic failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    console.log("\nNo database values were changed.");
    await db.$disconnect();
  });
