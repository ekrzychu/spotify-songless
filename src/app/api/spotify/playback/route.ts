import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSpotifySession } from "@/lib/spotify/auth";
import { SpotifyApiError, spotifyFetch } from "@/lib/spotify/api";

const playbackSchema = z.object({
  deviceId: z.string().min(1).max(128),
  spotifyUri: z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/),
  positionMs: z.number().int().min(0).max(3_600_000).default(0),
});

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const parsed = playbackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid playback request" }, { status: 400 });
  const session = await getSpotifySession();
  if (!session) return NextResponse.json({ error: "Reconnect Spotify" }, { status: 401 });
  try {
    await spotifyFetch<void>(
      session.accessToken,
      `/me/player/play?device_id=${encodeURIComponent(parsed.data.deviceId)}`,
      { method: "PUT", body: JSON.stringify({ uris: [parsed.data.spotifyUri], position_ms: parsed.data.positionMs }) },
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (process.env.NODE_ENV === "development") console.error(error);
    if (error instanceof SpotifyApiError && (error.status === 404 || error.status === 403)) {
      return NextResponse.json({ error: "This track is unavailable in your market.", code: "track_unavailable" }, { status: 409 });
    }
    return NextResponse.json({ error: "Playback could not start. Check your Spotify device." }, { status: 502 });
  }
}
