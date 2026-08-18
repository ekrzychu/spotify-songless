import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SpotifyTrack } from "@/lib/spotify/api";
import { normalizeIsrc } from "@/lib/streams/import-normalizer";
import { assignDerivedCategories } from "@/lib/catalog/derived-categories";
import { deriveGameEligibility } from "@/lib/catalog/game-eligibility";
import { deriveTrackLanguageState } from "@/lib/catalog/track-language";

export async function upsertCatalogTrack(track: SpotifyTrack, categoryId: string): Promise<"created" | "updated"> {
  const existing = await db.gameTrack.findUnique({
    where: { spotifyTrackId: track.id },
    select: { id: true, languageCode: true, languageSource: true },
  });
  const language = deriveTrackLanguageState({
    spotifyTrackId: track.id,
    title: track.name,
    albumName: track.album.name,
    existingLanguageCode: existing?.languageCode,
    existingLanguageSource: existing?.languageSource,
  });
  const data = {
    spotifyUri: track.uri,
    isrc: track.external_ids?.isrc ? normalizeIsrc(track.external_ids.isrc) : null,
    title: track.name,
    artistNames: track.artists.map((artist) => artist.name).join(", "),
    artistsJson: JSON.stringify(track.artists),
    albumName: track.album.name,
    releaseDate: track.album.release_date ?? null,
    playable: track.is_playable !== false,
    gameEligible: deriveGameEligibility(track.name).gameEligible,
    ...language,
    languageUpdatedAt: new Date(),
    spotifyUrl: track.external_urls.spotify,
  } satisfies Omit<Prisma.GameTrackUncheckedCreateInput, "spotifyTrackId">;

  const saved = await db.gameTrack.upsert({
    where: { spotifyTrackId: track.id },
    create: { spotifyTrackId: track.id, ...data },
    update: data,
  });
  await db.trackCategory.upsert({
    where: { trackId_categoryId: { trackId: saved.id, categoryId } },
    create: { trackId: saved.id, categoryId }, update: {},
  });
  await assignDerivedCategories(saved.id, saved.releaseDate);
  return existing ? "updated" : "created";
}
