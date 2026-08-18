import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  ACTIVE_GAME_GENRES,
  validateCategoryGameplayEligibility,
} from "@/lib/catalog/category-game-eligibility";
import { difficultyFromStreams } from "@/lib/game/difficulty";
import type { EnrichmentRecordingGroup } from "@/lib/streams/enrichment-selection";
import type { SoundchartsStreamCountResult } from "@/lib/streams/soundcharts-provider";
import type { RankedDifficulty } from "@/types/game";

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
  difficulty: RankedDifficulty | null;
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

async function validateFreshGenreMetadata(
  group: EnrichmentRecordingGroup,
  result: SoundchartsStreamCountResult,
  now: Date,
): Promise<void> {
  if (result.resolutionSource === "cached" || result.soundchartsGenres === null) return;
  const relations = await db.trackCategory.findMany({
    where: {
      trackId: { in: group.targetTrackIds },
      categoryId: { in: ACTIVE_GAME_GENRES.map((genre) => genre.id) },
    },
    select: {
      trackId: true,
      categoryId: true,
      gameEligible: true,
      gameEligibilitySource: true,
    },
  });
  const trackById = new Map(group.tracks.map((track) => [track.id, track]));
  await validateCategoryGameplayEligibility(
    group.targetTrackIds.map((trackId) => {
      const track = trackById.get(trackId);
      return {
        id: trackId,
        title: track?.title ?? trackId,
        artistNames: track?.artistNames ?? "",
        soundchartsGenres: result.soundchartsGenres!,
        categories: relations.filter((relation) => relation.trackId === trackId),
      };
    }),
    {
      updateRelation: async (trackId, categoryId, data) => {
        await db.trackCategory.update({
          where: { trackId_categoryId: { trackId, categoryId } },
          data,
        });
      },
    },
    { now },
  );
}

export async function enrichRecordingGroup(
  group: EnrichmentRecordingGroup,
  provider: SoundchartsEnrichmentProvider,
  options: { refresh?: boolean; now?: Date } = {},
): Promise<SoundchartsEnrichmentResult> {
  const now = options.now ?? new Date();
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
    languageEligible: true,
    ...eligibility,
  };

  if (providerResult.streamCount === null) {
    await db.gameTrack.updateMany({
      where,
      data: {
        soundchartsUuid: providerResult.soundchartsUuid,
        soundchartsNotFoundAt: null,
        ...soundchartsMetadataUpdate(providerResult),
      },
    });
    await validateFreshGenreMetadata(group, providerResult, now);
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
      soundchartsNotFoundAt: null,
      ...soundchartsMetadataUpdate(providerResult),
      streamCount: BigInt(providerResult.streamCount),
      difficulty,
      streamCountSource: "soundcharts",
      streamCountUpdatedAt: now,
    },
  });
  await validateFreshGenreMetadata(group, providerResult, now);
  return {
    status: "updated",
    localTracksUpdated: update.count,
    difficulty,
    providerResult,
  };
}
