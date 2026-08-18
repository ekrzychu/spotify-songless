import "dotenv/config";
import { db } from "../src/lib/db";
import { groupEnrichmentCandidates } from "../src/lib/streams/enrichment-selection";
import { markSoundchartsNotFoundTargets } from "../src/lib/streams/soundcharts-not-found";

function spotifyTrackIdFromArgs(args: readonly string[]): string {
  const inline = args.find((argument) => argument.startsWith("--spotify-track-id="));
  const optionIndex = args.indexOf("--spotify-track-id");
  const value = inline?.slice("--spotify-track-id=".length)
    ?? (optionIndex >= 0 ? args[optionIndex + 1] : undefined);
  if (!value || !/^[A-Za-z0-9]{22}$/u.test(value)) {
    throw new Error("--spotify-track-id requires a 22-character Spotify track ID.");
  }
  return value;
}

async function main(): Promise<void> {
  const spotifyTrackId = spotifyTrackIdFromArgs(process.argv.slice(2));
  const tracks = await db.gameTrack.findMany({
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
  const requestedTrack = tracks.find((track) => track.spotifyTrackId === spotifyTrackId);
  if (!requestedTrack) throw new Error(`Spotify track ID ${spotifyTrackId} is not in the local catalog.`);
  const group = groupEnrichmentCandidates(tracks).find((candidate) => (
    candidate.targetTrackIds.includes(requestedTrack.id)
  ));
  if (!group) {
    throw new Error("The requested track is not a current normal-enrichment target.");
  }
  const now = new Date();
  const marked = await markSoundchartsNotFoundTargets(group, { now });
  console.log([
    "SOUNDCHARTS NOT-FOUND MARKER",
    "",
    `Recording group: ${group.key}`,
    `Requested track: ${requestedTrack.title} - ${requestedTrack.artistNames}`,
    `Target tracks marked: ${marked}`,
    `Marked at: ${now.toISOString()}`,
    "No Spotify or Soundcharts request was made.",
  ].join("\n"));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Could not mark the recording group as not found");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
