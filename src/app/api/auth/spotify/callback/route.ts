import { NextRequest, NextResponse } from "next/server";
import { completeAuthorization } from "@/lib/spotify/auth";

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
    if (process.env.NODE_ENV === "development") console.error(error);
    return NextResponse.redirect(new URL("/?auth=failed", request.url));
  }
}
