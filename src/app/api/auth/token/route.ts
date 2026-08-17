import { NextResponse } from "next/server";
import { getSpotifySession } from "@/lib/spotify/auth";

export async function GET(): Promise<NextResponse> {
  const session = await getSpotifySession();
  if (!session) return NextResponse.json({ error: "Spotify connection required" }, { status: 401 });
  return NextResponse.json({ accessToken: session.accessToken, expiresAt: session.expiresAt }, {
    headers: { "Cache-Control": "no-store, private" },
  });
}
