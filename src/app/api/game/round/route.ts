import { NextRequest, NextResponse } from "next/server";
import { createRound, NoTracksError } from "@/lib/game/round-service";
import { getSessionId } from "@/lib/server/cookies";
import { filterSchema } from "@/lib/validation";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = filterSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid category or difficulty" }, { status: 400 });
  try {
    return NextResponse.json(await createRound(await getSessionId(), parsed.data.category, parsed.data.difficulty));
  } catch (error) {
    if (error instanceof NoTracksError) {
      return NextResponse.json({
        error: "No songs are currently available for this combination. Try another category or difficulty.",
      }, { status: 404 });
    }
    if (process.env.NODE_ENV === "development") console.error(error);
    return NextResponse.json({ error: "A new song could not be loaded" }, { status: 500 });
  }
}
