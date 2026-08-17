import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SpotifyTrack } from "@/lib/spotify/api";

export async function upsertCatalogTrack(track: SpotifyTrack, categoryId: string): Promise<void> {
  const data = {
    spotifyUri: track.uri,
    isrc: track.external_ids?.isrc ?? null,
    title: track.name,
    artistNames: track.artists.map((artist) => artist.name).join(", "),
    artistsJson: JSON.stringify(track.artists),
    albumName: track.album.name,
    releaseDate: track.album.release_date ?? null,
    playable: track.is_playable !== false,
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
}
