export type LocalStats = {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  bestStreak: number;
  guessDistribution: Record<1 | 2 | 3 | 4 | 5 | 6, number>;
  recordedRounds: string[];
};

export const EMPTY_STATS: LocalStats = {
  gamesPlayed: 0, gamesWon: 0, currentStreak: 0, bestStreak: 0,
  guessDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
  recordedRounds: [],
};

const KEY = "needle-drop:stats";

export function readStats(): LocalStats {
  try {
    return { ...EMPTY_STATS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<LocalStats> };
  } catch {
    return EMPTY_STATS;
  }
}

export function recordResult(roundId: string, won: boolean, attempts: number): LocalStats {
  const stats = readStats();
  if (stats.recordedRounds.includes(roundId)) return stats;
  const currentStreak = won ? stats.currentStreak + 1 : 0;
  const distribution = { ...stats.guessDistribution };
  if (won && attempts >= 1 && attempts <= 6) distribution[attempts as keyof typeof distribution] += 1;
  const updated: LocalStats = {
    ...stats,
    gamesPlayed: stats.gamesPlayed + 1,
    gamesWon: stats.gamesWon + (won ? 1 : 0),
    currentStreak,
    bestStreak: Math.max(stats.bestStreak, currentStreak),
    guessDistribution: distribution,
    recordedRounds: [...stats.recordedRounds.slice(-199), roundId],
  };
  localStorage.setItem(KEY, JSON.stringify(updated));
  return updated;
}

export function winRate(stats: LocalStats): number {
  return stats.gamesPlayed ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0;
}
