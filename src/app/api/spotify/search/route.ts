import { NextRequest, NextResponse } from "next/server";
import { searchLocalGuessTracks } from "@/lib/game/guess-search";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const requestedOffset = Number(request.nextUrl.searchParams.get("offset") ?? 0);
  const offset = Number.isFinite(requestedOffset)
    ? Math.min(Math.max(Math.floor(requestedOffset), 0), 5_000)
    : 0;
  if (query.length < 2 || query.length > 100) return NextResponse.json({ items: [], nextOffset: null });
  try {
    return NextResponse.json(await searchLocalGuessTracks(query, offset), {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") console.error(error);
    return NextResponse.json({ error: "Song search is temporarily unavailable" }, { status: 500 });
  }
}
