import type { GameTrack, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { GameDifficulty, SetProgressView } from "@/types/game";

export type SelectionInput = {
  sessionId: string;
  category: string;
  difficulty: GameDifficulty;
};

export type TrackSelection =
  | { status: "selected"; track: GameTrack }
  | { status: "empty" }
  | { status: "exhausted" };

function roundScopeWhere(input: SelectionInput, finished?: boolean): Prisma.GameRoundWhereInput {
  return {
    sessionId: input.sessionId,
    categoryId: input.category,
    difficulty: input.difficulty,
    ...(finished === undefined ? {} : { finished }),
  };
}

async function unavailableTrackIds(sessionId: string): Promise<string[]> {
  const unavailable = await db.sessionUnavailableTrack.findMany({
    where: { sessionId },
    select: { trackId: true },
  });
  return [...new Set(unavailable.map((item) => item.trackId))];
}

function excludingUnavailable(
  where: Prisma.GameTrackWhereInput,
  unavailableIds: string[],
): Prisma.GameTrackWhereInput {
  return unavailableIds.length ? { ...where, id: { notIn: unavailableIds } } : where;
}

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
      where: roundScopeWhere(input, true),
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
  const availableWhere = excludingUnavailable(baseWhere, unavailableIds);
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

export async function getSetProgress(input: SelectionInput): Promise<SetProgressView> {
  const [completedRounds, unavailableIds] = await Promise.all([
    db.gameRound.findMany({
      where: roundScopeWhere(input, true),
      select: { trackId: true },
    }),
    unavailableTrackIds(input.sessionId),
  ]);
  const eligibleWhere = excludingUnavailable(gameplaySelectionWhere(input.category, input.difficulty), unavailableIds);
  const completedIds = [...new Set(completedRounds.map((round) => round.trackId))];
  const [total, completed] = await Promise.all([
    db.gameTrack.count({ where: eligibleWhere }),
    completedIds.length
      ? db.gameTrack.count({ where: { ...eligibleWhere, id: { in: completedIds } } })
      : Promise.resolve(0),
  ]);
  return { completed, total };
}

export async function resetSetProgress(input: SelectionInput): Promise<number> {
  const result = await db.gameRound.deleteMany({ where: roundScopeWhere(input) });
  return result.count;
}
