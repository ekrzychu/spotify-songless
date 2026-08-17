import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Difficulty } from "@/types/game";

export type SelectionInput = {
  sessionId: string;
  category: string;
  difficulty: Difficulty;
};

export async function getRandomTrack(input: SelectionInput) {
  const played = await db.gameRound.findMany({
    where: { sessionId: input.sessionId },
    select: { trackId: true },
    orderBy: { createdAt: "desc" },
  });
  const baseWhere: Prisma.GameTrackWhereInput = {
    playable: true,
    streamCount: { not: null },
    difficulty: input.difficulty,
    ...(input.category === "all" ? {} : { categories: { some: { categoryId: input.category } } }),
  };
  const excluded = [...new Set(played.map((round) => round.trackId))];
  let where: Prisma.GameTrackWhereInput = excluded.length
    ? { ...baseWhere, id: { notIn: excluded } }
    : baseWhere;
  let count = await db.gameTrack.count({ where });

  // Once a finite catalog is exhausted, keep only the most recent track excluded.
  if (count === 0 && excluded.length > 0) {
    where = { ...baseWhere, id: { not: excluded[0]! } };
    count = await db.gameTrack.count({ where });
  }
  if (count === 0) return null;
  const skip = Math.floor(Math.random() * count);
  return db.gameTrack.findFirst({ where, skip });
}
