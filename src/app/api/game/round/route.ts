import { NextRequest, NextResponse } from "next/server";
import { createRound, NoTracksError, PoolExhaustedError } from "@/lib/game/round-service";
import { getSessionId } from "@/lib/server/cookies";
import { filterSchema } from "@/lib/validation";
import { db } from "@/lib/db";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = filterSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid category or difficulty" }, { status: 400 });
  try {
    return NextResponse.json(await createRound(await getSessionId(), parsed.data.category, parsed.data.difficulty));
  } catch (error) {
    if (error instanceof PoolExhaustedError) {
      return NextResponse.json({
        code: "pool_exhausted",
        error: "Every available song in this pool has already been played in this session.",
      }, { status: 409 });
    }
    if (error instanceof NoTracksError) {
      let message = "No songs are currently available for this combination. Try another category or difficulty.";
      if (process.env.NODE_ENV === "development") {
        const [catalogTracks, rankedTracks] = await Promise.all([
          db.gameTrack.count(),
          db.gameTrack.count({ where: { playable: true, streamCount: { not: null } } }),
        ]);
        if (parsed.data.difficulty !== "unranked" && catalogTracks > 0 && rankedTracks === 0) {
          message = "No ranked songs are available yet. Import verified stream-count data to enable gameplay.";
        }
      }
      return NextResponse.json({
        error: message,
      }, { status: 404 });
    }
    if (process.env.NODE_ENV === "development") console.error(error);
    return NextResponse.json({ error: "A new song could not be loaded" }, { status: 500 });
  }
}
