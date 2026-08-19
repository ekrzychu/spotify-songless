import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeSearchText, rankAndDedupeVisibleTracks } from "@/lib/game/search-match";
import type { SearchTrack } from "@/types/game";

export const LOCAL_GUESS_SEARCH_RESULT_LIMIT = 8;
export const LOCAL_GUESS_SEARCH_CANDIDATE_LIMIT = 100;

type LocalGuessTrack = SearchTrack & { artistsJson: string };

function searchFragments(token: string): string[] {
  if (token.length <= 2) return [token];
  if (token.length === 3) return [token.slice(0, 2)];
  return [...new Set([token.slice(0, 3), token.slice(-2)])];
}

function guessSearchWhere(query: string, allowApproximateFragments: boolean): Prisma.GameTrackWhereInput {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  return {
    playable: true,
    AND: tokens.map((token) => ({
      OR: (allowApproximateFragments ? searchFragments(token) : [token]).flatMap((fragment) => [
        { title: { contains: fragment } },
        { artistNames: { contains: fragment } },
      ]),
    })),
  };
}

export function localGuessSearchWhere(query: string): Prisma.GameTrackWhereInput {
  return guessSearchWhere(query, false);
}

function artistNamesForRanking(track: LocalGuessTrack): string[] {
  try {
    const artists: unknown = JSON.parse(track.artistsJson);
    if (Array.isArray(artists)) {
      const names = artists.flatMap((artist) => (
        artist && typeof artist === "object" && "name" in artist && typeof artist.name === "string"
          ? [artist.name]
          : []
      ));
      if (names.length) return names;
    }
  } catch {
    // Fall back to the catalog's display string for legacy or malformed rows.
  }
  return [track.artistNames];
}

export async function searchLocalGuessTracks(
  query: string,
  offset: number,
): Promise<{ items: SearchTrack[]; nextOffset: number | null }> {
  const queryCandidates = (where: Prisma.GameTrackWhereInput) => db.gameTrack.findMany({
    where,
    select: {
      spotifyTrackId: true,
      isrc: true,
      title: true,
      artistNames: true,
      artistsJson: true,
      albumName: true,
    },
    orderBy: [
      { title: "asc" },
      { artistNames: "asc" },
      { spotifyTrackId: "asc" },
    ],
    skip: offset,
    take: LOCAL_GUESS_SEARCH_CANDIDATE_LIMIT + 1,
  });
  const strongCandidates = await queryCandidates(localGuessSearchWhere(query));
  const approximateCandidates = strongCandidates.length >= LOCAL_GUESS_SEARCH_CANDIDATE_LIMIT
    ? []
    : await queryCandidates(guessSearchWhere(query, true));
  const seenTrackIds = new Set<string>();
  const candidates = [...strongCandidates, ...approximateCandidates].filter((track) => {
    if (seenTrackIds.has(track.spotifyTrackId)) return false;
    seenTrackIds.add(track.spotifyTrackId);
    return true;
  });
  const hasNextPage = strongCandidates.length > LOCAL_GUESS_SEARCH_CANDIDATE_LIMIT
    || approximateCandidates.length > LOCAL_GUESS_SEARCH_CANDIDATE_LIMIT
    || candidates.length > LOCAL_GUESS_SEARCH_CANDIDATE_LIMIT;
  const page = candidates.slice(0, LOCAL_GUESS_SEARCH_CANDIDATE_LIMIT);
  const ranked = rankAndDedupeVisibleTracks(
    query,
    page,
    (track) => ({ title: track.title, artistNames: artistNamesForRanking(track) }),
    LOCAL_GUESS_SEARCH_RESULT_LIMIT,
  );

  return {
    items: ranked.map((track) => ({
      spotifyTrackId: track.spotifyTrackId,
      isrc: track.isrc,
      title: track.title,
      artistNames: track.artistNames,
      albumName: track.albumName,
    })),
    nextOffset: hasNextPage ? offset + LOCAL_GUESS_SEARCH_CANDIDATE_LIMIT : null,
  };
}
