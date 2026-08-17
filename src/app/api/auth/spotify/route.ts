import { NextResponse } from "next/server";
import { createAuthorizationUrl } from "@/lib/spotify/auth";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.redirect(await createAuthorizationUrl());
  } catch (error) {
    if (process.env.NODE_ENV === "development") console.error(error);
    return NextResponse.redirect(new URL("/?auth=config", process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:3000"));
  }
}
