import { NextResponse } from "next/server";
import { getSpotifySession } from "@/lib/spotify/auth";

export async function GET(): Promise<NextResponse> {
  const session = await getSpotifySession();
  return NextResponse.json({ connected: Boolean(session) });
}
