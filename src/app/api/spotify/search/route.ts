import { NextRequest, NextResponse } from "next/server";
import { getSpotifySession } from "@/lib/spotify/auth";
import { spotifyFetch, type SpotifySearchResponse } from "@/lib/spotify/api";
import { SPOTIFY_SEARCH_LIMIT } from "@/lib/catalog/spotify-pagination";
import { rankAndDedupeVisibleTracks } from "@/lib/spotify/search-match";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const offset = Math.min(Math.max(Number(request.nextUrl.searchParams.get("offset") ?? 0), 0), 100);
  if (query.length < 2 || query.length > 100) return NextResponse.json({ items: [], nextOffset: null });
  const session = await getSpotifySession();
  if (!session) return NextResponse.json({ error: "Reconnect Spotify" }, { status: 401 });
  try {
    const params = new URLSearchParams({
      q: query, type: "track", limit: String(SPOTIFY_SEARCH_LIMIT), offset: String(offset),
    });
    const result = await spotifyFetch<SpotifySearchResponse>(session.accessToken, `/search?${params}`);
    const candidates = result.tracks.items.map((track) => ({
      item: {
        spotifyTrackId: track.id, isrc: track.external_ids?.isrc ?? null,
        title: track.name, artistNames: track.artists.map((artist) => artist.name).join(", "),
        albumName: track.album.name,
      },
      visible: { title: track.name, artistNames: track.artists.map((artist) => artist.name) },
    }));
    return NextResponse.json({
      items: rankAndDedupeVisibleTracks(query, candidates, (candidate) => candidate.visible)
        .map((candidate) => candidate.item),
      nextOffset: result.tracks.next ? offset + result.tracks.items.length : null,
    }, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (error) {
    if (process.env.NODE_ENV === "development") console.error(error);
    return NextResponse.json({ error: "Song search is temporarily unavailable" }, { status: 502 });
  }
}
