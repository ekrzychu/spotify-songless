import { NextRequest, NextResponse } from "next/server";
import { getRound, RoundNotFoundError } from "@/lib/game/round-service";
import { getSessionId } from "@/lib/server/cookies";
import { roundIdSchema } from "@/lib/validation";

export async function GET(_request: NextRequest, context: { params: Promise<{ roundId: string }> }): Promise<NextResponse> {
  const { roundId } = await context.params;
  if (!roundIdSchema.safeParse(roundId).success) return NextResponse.json({ error: "Invalid round" }, { status: 400 });
  try {
    return NextResponse.json(await getRound(roundId, await getSessionId()));
  } catch (error) {
    if (error instanceof RoundNotFoundError) return NextResponse.json({ error: "Round not found" }, { status: 404 });
    return NextResponse.json({ error: "Round could not be loaded" }, { status: 500 });
  }
}
