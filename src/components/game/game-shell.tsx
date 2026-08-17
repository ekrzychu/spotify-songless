"use client";

import { useCallback, useEffect, useState } from "react";
import { AttemptList } from "@/components/game/attempt-list";
import { DurationBar } from "@/components/game/duration-bar";
import { FilterBar } from "@/components/game/filter-bar";
import { GuessSearch } from "@/components/game/guess-search";
import { PlayButton } from "@/components/game/play-button";
import { ResultPanel } from "@/components/game/result-panel";
import { StatsSummary } from "@/components/game/stats-summary";
import { EMPTY_STATS, readStats, recordResult, type LocalStats } from "@/lib/client/stats";
import { useSpotifyPlayer } from "@/hooks/use-spotify-player";
import type { Difficulty, RoundView, SearchTrack } from "@/types/game";

type Filters = { category: string; difficulty: Difficulty };
type SavedRound = { id: string; category: string; difficulty: Difficulty };
const DEFAULT_FILTERS: Filters = { category: "all", difficulty: "normal" };
const FILTER_KEY = "needle-drop:filters";
const ROUND_KEY = "needle-drop:round";

export function GameShell() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [hydrated, setHydrated] = useState(false);
  const [round, setRound] = useState<RoundView | null>(null);
  const [loadingRound, setLoadingRound] = useState(false);
  const [attemptBusy, setAttemptBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingFilters, setPendingFilters] = useState<Filters | null>(null);
  const [stats, setStats] = useState<LocalStats>(EMPTY_STATS);
  const player = useSpotifyPlayer(connected === true);
  const pausePlayer = player.pause;

  const newRound = useCallback(async (nextFilters: Filters) => {
    setLoadingRound(true); setNotice(null); await pausePlayer();
    try {
      const response = await fetch("/api/game/round", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextFilters),
      });
      const payload = await response.json() as RoundView & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "A song could not be loaded");
      setRound(payload);
      localStorage.setItem(ROUND_KEY, JSON.stringify({ id: payload.id, ...nextFilters }));
    } catch (error) {
      setRound(null); setNotice(error instanceof Error ? error.message : "A song could not be loaded");
    } finally { setLoadingRound(false); }
  }, [pausePlayer]);

  useEffect(() => {
    let active = true;
    let stored = DEFAULT_FILTERS;
    try { stored = { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}") as Partial<Filters> }; } catch { /* defaults */ }
    queueMicrotask(() => {
      if (!active) return;
      setFilters(stored); setStats(readStats()); setHydrated(true);
    });
    void fetch("/api/auth/status", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ connected: boolean }>)
      .then((value) => { if (active) setConnected(value.connected); })
      .catch(() => { if (active) setConnected(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!hydrated || !connected) return;
    let saved: SavedRound | null = null;
    try { saved = JSON.parse(localStorage.getItem(ROUND_KEY) ?? "null") as SavedRound | null; } catch { /* new round */ }
    if (saved && saved.category === filters.category && saved.difficulty === filters.difficulty) {
      void Promise.resolve().then(() => {
        setLoadingRound(true);
        return fetch(`/api/game/round/${encodeURIComponent(saved.id)}`, { cache: "no-store" });
      })
        .then(async (response) => {
          if (!response.ok) throw new Error();
          setRound(await response.json() as RoundView);
        })
        .catch(() => newRound(filters))
        .finally(() => setLoadingRound(false));
    } else void Promise.resolve().then(() => newRound(filters));
    // Restoring is intentionally keyed only to authentication/hydration; filter changes call newRound explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, hydrated]);

  useEffect(() => {
    if (!round?.finished) return;
    const completed = round;
    queueMicrotask(() => setStats(recordResult(completed.id, completed.won, completed.attempts.length)));
  }, [round]);

  const play = useCallback(() => {
    if (!round || round.finished || loadingRound) return;
    if (player.playing) void player.pause();
    else void player.playSnippet(round.spotifyUri, round.snippetLength).catch((error: unknown) => {
      if (error instanceof Error && error.message === "TRACK_UNAVAILABLE") {
        setNotice("That track is unavailable here. Choosing another…");
        void fetch(`/api/game/round/${round.id}/unavailable`, { method: "POST" })
          .then(async (response) => {
            const payload = await response.json() as RoundView & { error?: string };
            if (!response.ok) throw new Error(payload.error);
            setRound(payload); setNotice(null);
          })
          .catch((replacementError: unknown) => setNotice(replacementError instanceof Error ? replacementError.message : "No replacement was available"));
      } else setNotice(error instanceof Error ? error.message : "Playback failed");
    });
  }, [loadingRound, player, round]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code !== "Space" || target?.matches("input, select, button, [contenteditable=true]")) return;
      event.preventDefault(); play();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [play]);

  const attempt = async (guess: SearchTrack | null) => {
    if (!round || round.finished || attemptBusy) return;
    setAttemptBusy(true); setNotice(null); await player.pause();
    try {
      const response = await fetch(`/api/game/round/${round.id}/attempt`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guessTrackId: guess?.spotifyTrackId ?? null }),
      });
      const payload = await response.json() as RoundView & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The attempt was not recorded");
      setRound(payload);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The attempt was not recorded"); }
    finally { setAttemptBusy(false); }
  };

  const applyFilters = (next: Filters) => {
    setFilters(next); localStorage.setItem(FILTER_KEY, JSON.stringify(next));
    setPendingFilters(null); void newRound(next);
  };

  const requestFilters = (next: Filters) => {
    if (round && !round.finished) setPendingFilters(next);
    else applyFilters(next);
  };

  return (
    <main className="game-shell">
      <header className="site-header">
        <div><span className="wordmark-mark" aria-hidden="true" /><h1>Needle Drop</h1></div>
        {connected && <button className="connection" type="button" onClick={() => void fetch("/api/auth/logout", { method: "POST" }).then(() => location.reload())}><span />Spotify</button>}
      </header>

      <section className="game" aria-busy={loadingRound}>
        <div className="game-heading">
          <p>Unlimited song guessing</p>
          <FilterBar category={filters.category} difficulty={filters.difficulty} disabled={!connected || loadingRound} onChange={requestFilters} />
        </div>

        {connected === null ? (
          <div className="connect-state connect-state--loading" role="status">
            <span className="connect-disc" aria-hidden="true" />
            <p>Checking Spotify connection…</p>
          </div>
        ) : connected === false ? (
          <div className="connect-state">
            <span className="connect-disc" aria-hidden="true" />
            <h2>Connect Spotify to play</h2>
            <p>A Spotify Premium account is required for full-track browser playback.</p>
            <a href="/api/auth/spotify">Connect Spotify</a>
          </div>
        ) : (
          <>
            <AttemptList attempts={round?.attempts ?? []} currentAttempt={round?.attempt ?? 0} finished={round?.finished ?? false} />
            <DurationBar attempt={round?.attempt ?? 0} progress={player.progress} />
            <div className="play-area">
              <PlayButton playing={player.playing} disabled={!round || round.finished || !player.ready || loadingRound} onClick={play} />
              <p>{loadingRound ? "Choosing a song…" : player.status === "loading" ? "Preparing Spotify…" : player.status === "offline" ? "Player offline" : `Play ${round?.snippetLength ?? 0.1}s intro`}</p>
            </div>
            <GuessSearch disabled={!round || round.finished || loadingRound} busy={attemptBusy} onAttempt={(guess) => void attempt(guess)} />
          </>
        )}

        {(notice || player.error) && <div className="notice" role="status">{notice ?? player.error}</div>}
        {connected && !loadingRound && !round && <button className="retry-button" type="button" onClick={() => void newRound(filters)}>Try again</button>}
      </section>

      <StatsSummary stats={stats} />
      <footer><span>Six chances. No daily limit.</span><span>Space to play</span></footer>

      {round?.finished && round.answer && <ResultPanel won={round.won} attempts={round.attempts.length} answer={round.answer} onNext={() => void newRound(filters)} />}
      {pendingFilters && (
        <div className="confirm-backdrop">
          <section className="confirm-panel" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <h2 id="confirm-title">Start a new song?</h2>
            <p>Your progress on this song will be left behind.</p>
            <div><button type="button" onClick={() => setPendingFilters(null)}>Keep playing</button><button type="button" onClick={() => applyFilters(pendingFilters)}>Start new song</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
