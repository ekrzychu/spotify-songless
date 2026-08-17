import type { LocalStats } from "@/lib/client/stats";
import { winRate } from "@/lib/client/stats";

export function StatsSummary({ stats }: { stats: LocalStats }) {
  const maximum = Math.max(...Object.values(stats.guessDistribution), 1);
  return (
    <details className="stats">
      <summary>{stats.gamesPlayed} played <span>·</span> {winRate(stats)}% won <span>·</span> streak {stats.currentStreak}</summary>
      <div className="stats-panel">
        <div className="stats-numbers">
          <div><strong>{stats.gamesPlayed}</strong><span>Played</span></div>
          <div><strong>{winRate(stats)}%</strong><span>Win rate</span></div>
          <div><strong>{stats.bestStreak}</strong><span>Best streak</span></div>
        </div>
        <p>Guess distribution</p>
        <ol className="distribution">
          {Object.entries(stats.guessDistribution).map(([guess, count]) => (
            <li key={guess}><span>{guess}</span><i style={{ width: `${Math.max((count / maximum) * 100, 7)}%` }}>{count}</i></li>
          ))}
        </ol>
      </div>
    </details>
  );
}
