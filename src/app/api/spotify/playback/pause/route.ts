import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSpotifySession } from "@/lib/spotify/auth";
import { spotifyFetch } from "@/lib/spotify/api";
import { classifyPlaybackError, PLAYBACK_ERROR_RESPONSES } from "@/lib/spotify/playback-errors";

const pauseSchema = z.object({
  deviceId: z.string().min(1).max(128),
});

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const parsed = pauseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid playback pause request" }, { status: 400 });
  const session = await getSpotifySession();
  if (!session) return NextResponse.json({ error: "Reconnect Spotify" }, { status: 401 });
  try {
    await spotifyFetch<void>(
      session.accessToken,
      `/me/player/pause?device_id=${encodeURIComponent(parsed.data.deviceId)}`,
      { method: "PUT" },
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const code = classifyPlaybackError(error);
    const response = PLAYBACK_ERROR_RESPONSES[code];
    if (process.env.NODE_ENV === "development") {
      const status = error && typeof error === "object" && "status" in error ? String(error.status) : "unknown";
      console.error(`Spotify pause failed: status ${status}; classified ${code}`);
    }
    return NextResponse.json({ error: response.message, code }, { status: response.status });
  }
}
