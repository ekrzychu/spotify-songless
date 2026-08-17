import { NextResponse } from "next/server";
import { clearSpotifySession } from "@/lib/spotify/auth";

export async function POST(): Promise<NextResponse> {
  await clearSpotifySession();
  return NextResponse.json({ ok: true });
}
