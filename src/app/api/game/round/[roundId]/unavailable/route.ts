import { NextRequest, NextResponse } from "next/server";
import { NoTracksError, replaceUnavailableRound, RoundNotFoundError } from "@/lib/game/round-service";
import { getSessionId } from "@/lib/server/cookies";
import { roundIdSchema } from "@/lib/validation";

export async function POST(_request: NextRequest, context: { params: Promise<{ roundId: string }> }): Promise<NextResponse> {
  const { roundId } = await context.params;
  if (!roundIdSchema.safeParse(roundId).success) return NextResponse.json({ error: "Invalid round" }, { status: 400 });
  try {
    return NextResponse.json(await replaceUnavailableRound(roundId, await getSessionId()));
  } catch (error) {
    if (error instanceof RoundNotFoundError) return NextResponse.json({ error: "Round not found" }, { status: 404 });
    if (error instanceof NoTracksError) return NextResponse.json({ error: "No other playable song is available" }, { status: 404 });
    return NextResponse.json({ error: "A replacement song could not be loaded" }, { status: 500 });
  }
}
