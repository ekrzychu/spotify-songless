import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Difficulty } from "@/types/game";

export type SelectionInput = {
  sessionId: string;
  category: string;
  difficulty: Difficulty;
};

export async function getRandomTrack(input: SelectionInput) {
  const [played, unavailable] = await Promise.all([
    db.gameRound.findMany({
      where: { sessionId: input.sessionId },
      select: { trackId: true },
      orderBy: { createdAt: "desc" },
    }),
    db.sessionUnavailableTrack.findMany({
      where: { sessionId: input.sessionId },
      select: { trackId: true },
    }),
  ]);
  const baseWhere: Prisma.GameTrackWhereInput = {
    playable: true,
    streamCount: { not: null },
    difficulty: input.difficulty,
    ...(input.category === "all" ? {} : { categories: { some: { categoryId: input.category } } }),
  };
  const playedIds = [...new Set(played.map((round) => round.trackId))];
  const unavailableIds = [...new Set(unavailable.map((item) => item.trackId))];
  const selectionTiers = [
    [...new Set([...unavailableIds, ...playedIds])],
    [...new Set([...unavailableIds, ...(playedIds[0] ? [playedIds[0]] : [])])],
    unavailableIds,
  ];
  for (const excluded of selectionTiers) {
    const where: Prisma.GameTrackWhereInput = excluded.length
      ? { ...baseWhere, id: { notIn: excluded } }
      : baseWhere;
    const count = await db.gameTrack.count({ where });
    if (count > 0) {
      return db.gameTrack.findFirst({ where, skip: Math.floor(Math.random() * count) });
    }
    if (playedIds.length === 0) break;
  }
  return null;
}
