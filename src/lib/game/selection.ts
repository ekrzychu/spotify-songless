import type { GameTrack, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { GameDifficulty } from "@/types/game";

export type SelectionInput = {
  sessionId: string;
  category: string;
  difficulty: GameDifficulty;
};

export type TrackSelection =
  | { status: "selected"; track: GameTrack }
  | { status: "empty" }
  | { status: "exhausted" };

export function gameplaySelectionWhere(
  category: string,
  difficulty: GameDifficulty,
): Prisma.GameTrackWhereInput {
  const rankingState: Prisma.GameTrackWhereInput = difficulty === "unranked"
    ? { OR: [{ streamCount: null }, { difficulty: null }] }
    : { streamCount: { not: null }, difficulty };
  return {
    playable: true,
    gameEligible: true,
    languageEligible: true,
    ...rankingState,
    ...(category === "all" ? {} : {
      categories: { some: { categoryId: category, gameEligible: true } },
    }),
  };
}

export async function selectRandomTrack(input: SelectionInput): Promise<TrackSelection> {
  const [played, unavailable] = await Promise.all([
    db.gameRound.findMany({
      where: { sessionId: input.sessionId, categoryId: input.category, difficulty: input.difficulty },
      select: { trackId: true },
    }),
    db.sessionUnavailableTrack.findMany({
      where: { sessionId: input.sessionId },
      select: { trackId: true },
    }),
  ]);
  const baseWhere = gameplaySelectionWhere(input.category, input.difficulty);
  const playedIds = [...new Set(played.map((round) => round.trackId))];
  const unavailableIds = [...new Set(unavailable.map((item) => item.trackId))];
  const availableWhere: Prisma.GameTrackWhereInput = unavailableIds.length
    ? { ...baseWhere, id: { notIn: unavailableIds } }
    : baseWhere;
  const availableCount = await db.gameTrack.count({ where: availableWhere });
  if (availableCount === 0) return { status: "empty" };

  const excludedIds = [...new Set([...unavailableIds, ...playedIds])];
  const remainingWhere: Prisma.GameTrackWhereInput = excludedIds.length
    ? { ...baseWhere, id: { notIn: excludedIds } }
    : baseWhere;
  const remainingCount = playedIds.length
    ? await db.gameTrack.count({ where: remainingWhere })
    : availableCount;
  if (remainingCount === 0) return { status: "exhausted" };

  const track = await db.gameTrack.findFirst({
    where: remainingWhere,
    skip: Math.floor(Math.random() * remainingCount),
  });
  return track ? { status: "selected", track } : { status: "empty" };
}
