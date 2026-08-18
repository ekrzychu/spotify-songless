import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { difficultyFromStreams } from "@/lib/game/difficulty";
import type { EnrichmentRecordingGroup } from "@/lib/streams/enrichment-selection";
import type { SoundchartsStreamCountResult } from "@/lib/streams/soundcharts-provider";
import type { Difficulty } from "@/types/game";

export interface SoundchartsEnrichmentProvider {
  getStreamCountResult(input: {
    spotifyTrackId: string;
    isrc: string | null;
    soundchartsUuid: string | null;
  }): Promise<SoundchartsStreamCountResult>;
}

export type SoundchartsEnrichmentResult = {
  status: "updated" | "audience_unavailable";
  localTracksUpdated: number;
  difficulty: Difficulty | null;
  providerResult: SoundchartsStreamCountResult;
};

function soundchartsMetadataUpdate(
  result: SoundchartsStreamCountResult,
): Pick<Prisma.GameTrackUpdateManyMutationInput, "soundchartsReleaseDate" | "soundchartsGenresJson"> {
  return {
    ...(result.soundchartsReleaseDate === null
      ? {}
      : { soundchartsReleaseDate: result.soundchartsReleaseDate }),
    ...(result.soundchartsGenres === null
      ? {}
      : { soundchartsGenresJson: JSON.stringify(result.soundchartsGenres) }),
  };
}

export async function enrichRecordingGroup(
  group: EnrichmentRecordingGroup,
  provider: SoundchartsEnrichmentProvider,
  options: { refresh?: boolean; now?: Date } = {},
): Promise<SoundchartsEnrichmentResult> {
  const providerResult = await provider.getStreamCountResult({
    spotifyTrackId: group.representative.spotifyTrackId,
    isrc: group.normalizedIsrc ?? group.representative.isrc,
    soundchartsUuid: group.cachedSoundchartsUuid,
  });
  const eligibility: Prisma.GameTrackWhereInput = options.refresh
    ? { OR: [{ streamCount: null }, { streamCountSource: "soundcharts" }] }
    : { streamCount: null };
  const where: Prisma.GameTrackWhereInput = {
    id: { in: group.targetTrackIds },
    ...eligibility,
  };

  if (providerResult.streamCount === null) {
    await db.gameTrack.updateMany({
      where,
      data: {
        soundchartsUuid: providerResult.soundchartsUuid,
        ...soundchartsMetadataUpdate(providerResult),
      },
    });
    return {
      status: "audience_unavailable",
      localTracksUpdated: 0,
      difficulty: null,
      providerResult,
    };
  }

  const difficulty = difficultyFromStreams(providerResult.streamCount);
  const update = await db.gameTrack.updateMany({
    where,
    data: {
      soundchartsUuid: providerResult.soundchartsUuid,
      ...soundchartsMetadataUpdate(providerResult),
      streamCount: BigInt(providerResult.streamCount),
      difficulty,
      streamCountSource: "soundcharts",
      streamCountUpdatedAt: options.now ?? new Date(),
    },
  });
  return {
    status: "updated",
    localTracksUpdated: update.count,
    difficulty,
    providerResult,
  };
}
