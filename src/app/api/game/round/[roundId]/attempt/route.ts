import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordAttempt, RoundFinishedError, RoundNotFoundError } from "@/lib/game/round-service";
import { getSessionId } from "@/lib/server/cookies";
import { getSpotifySession } from "@/lib/spotify/auth";
import { spotifyFetch, type SpotifyTrack } from "@/lib/spotify/api";
import { roundIdSchema, spotifyTrackIdSchema } from "@/lib/validation";

const bodySchema = z.object({ guessTrackId: spotifyTrackIdSchema.nullable() });

export async function POST(request: NextRequest, context: { params: Promise<{ roundId: string }> }): Promise<NextResponse> {
  const { roundId } = await context.params;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!roundIdSchema.safeParse(roundId).success || !body.success) {
    return NextResponse.json({ error: "Invalid attempt" }, { status: 400 });
  }
  try {
    let guess = null;
    if (body.data.guessTrackId) {
      const session = await getSpotifySession();
      if (!session) return NextResponse.json({ error: "Reconnect Spotify" }, { status: 401 });
      const track = await spotifyFetch<SpotifyTrack>(session.accessToken, `/tracks/${body.data.guessTrackId}`);
      guess = {
        spotifyTrackId: track.id, isrc: track.external_ids?.isrc ?? null,
        title: track.name, artistNames: track.artists.map((artist) => artist.name).join(", "),
        albumName: track.album.name,
      };
    }
    return NextResponse.json(await recordAttempt(roundId, await getSessionId(), guess));
  } catch (error) {
    if (error instanceof RoundNotFoundError) return NextResponse.json({ error: "Round not found" }, { status: 404 });
    if (error instanceof RoundFinishedError) return NextResponse.json({ error: "Round already finished" }, { status: 409 });
    if (process.env.NODE_ENV === "development") console.error(error);
    return NextResponse.json({ error: "The attempt could not be recorded" }, { status: 500 });
  }
}
