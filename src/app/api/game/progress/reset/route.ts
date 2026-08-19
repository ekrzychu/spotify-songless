import { NextRequest, NextResponse } from "next/server";
import { resetSetProgress } from "@/lib/game/selection";
import { getSessionId } from "@/lib/server/cookies";
import { filterSchema } from "@/lib/validation";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = filterSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid category or difficulty" }, { status: 400 });
  try {
    const deletedRounds = await resetSetProgress({
      sessionId: await getSessionId(),
      category: parsed.data.category,
      difficulty: parsed.data.difficulty,
    });
    return NextResponse.json({ deletedRounds });
  } catch (error) {
    if (process.env.NODE_ENV === "development") console.error(error);
    return NextResponse.json({ error: "Set progress could not be reset" }, { status: 500 });
  }
}
