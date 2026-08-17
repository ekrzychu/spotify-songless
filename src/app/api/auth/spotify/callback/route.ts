import { NextRequest, NextResponse } from "next/server";
import { completeAuthorization, getSpotifySession, OAuthStateError } from "@/lib/spotify/auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state || request.nextUrl.searchParams.has("error")) {
    return NextResponse.redirect(new URL("/?auth=denied", request.url));
  }
  try {
    await completeAuthorization(code, state);
    return NextResponse.redirect(new URL("/?auth=connected", request.url));
  } catch (error) {
    const validSession = Boolean(await getSpotifySession());
    if (process.env.NODE_ENV === "development") {
      const reason = error instanceof OAuthStateError ? `state ${error.reason}` : "token exchange";
      console.error(`OAuth callback failed: ${reason}`);
    }
    return NextResponse.redirect(new URL(`/?auth=${validSession ? "stale" : "failed"}`, request.url));
  }
}
