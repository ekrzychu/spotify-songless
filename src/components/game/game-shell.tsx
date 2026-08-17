"use client";

import { useCallback, useEffect, useState } from "react";
import { AttemptList } from "@/components/game/attempt-list";
import { DurationBar } from "@/components/game/duration-bar";
import { FilterBar } from "@/components/game/filter-bar";
import { GuessSearch } from "@/components/game/guess-search";
import { PlayButton } from "@/components/game/play-button";
import { ResultPanel } from "@/components/game/result-panel";
import { StatsSummary } from "@/components/game/stats-summary";
import { ConfirmDialog } from "@/components/game/confirm-dialog";
import { EMPTY_STATS, readStats, recordResult, type LocalStats } from "@/lib/client/stats";
import { migrateStorageKey, STORAGE_KEYS } from "@/lib/client/storage";
import { checkSpotifyConnection, oauthNotice, type SpotifyConnectionState } from "@/lib/client/spotify-connection";
import { PlaybackRequestError, useSpotifyPlayer } from "@/hooks/use-spotify-player";
import { getCategory } from "@/lib/catalog/category-config";
import { DIFFICULTY_LABELS } from "@/lib/game/difficulty";
import { MAX_ATTEMPTS } from "@/lib/game/snippets";
import type { Difficulty, RoundView, SearchTrack } from "@/types/game";

type Filters = { category: string; difficulty: Difficulty };
type SavedRound = { id: string; category: string; difficulty: Difficulty };
const DEFAULT_FILTERS: Filters = { category: "all", difficulty: "normal" };

export function GameShell() {
  const [connection, setConnection] = useState<SpotifyConnectionState>("checking");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [hydrated, setHydrated] = useState(false);
  const [round, setRound] = useState<RoundView | null>(null);
  const [loadingRound, setLoadingRound] = useState(false);
  const [attemptBusy, setAttemptBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<{ text: string; success: boolean } | null>(null);
  const [pendingFilters, setPendingFilters] = useState<Filters | null>(null);
  const [exhaustedPool, setExhaustedPool] = useState<Filters | null>(null);
  const [stats, setStats] = useState<LocalStats>(EMPTY_STATS);
  const connected = connection === "connected";
  const player = useSpotifyPlayer(connected);
  const resetPlayback = player.resetPlayback;

  const newRound = useCallback(async (nextFilters: Filters) => {
    setLoadingRound(true); setNotice(null); setExhaustedPool(null); await resetPlayback();
    try {
      const response = await fetch("/api/game/round", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextFilters),
      });
      const payload = await response.json() as RoundView & { error?: string; code?: string };
      if (response.status === 409 && payload.code === "pool_exhausted") {
        setRound(null);
        setExhaustedPool(nextFilters);
        localStorage.removeItem(STORAGE_KEYS.round);
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "A song could not be loaded");
      setRound(payload);
      localStorage.setItem(STORAGE_KEYS.round, JSON.stringify({ id: payload.id, ...nextFilters }));
    } catch (error) {
      setRound(null); setNotice(error instanceof Error ? error.message : "A song could not be loaded");
    } finally { setLoadingRound(false); }
  }, [resetPlayback]);

  const refreshConnection = useCallback(async () => {
    setConnection("checking");
    try {
      const isConnected = await checkSpotifyConnection();
      setConnection(isConnected ? "connected" : "disconnected");
      const url = new URL(window.location.href);
      setAuthNotice(oauthNotice(url.searchParams.get("auth"), isConnected));
      if (url.searchParams.has("auth")) {
        url.searchParams.delete("auth");
        history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
    } catch (error) {
      setConnection("error");
      if (process.env.NODE_ENV === "development") console.error("Spotify connection status check failed", error);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let stored = DEFAULT_FILTERS;
    try { stored = { ...DEFAULT_FILTERS, ...JSON.parse(migrateStorageKey("filters") ?? "{}") as Partial<Filters> }; } catch { /* defaults */ }
    queueMicrotask(() => {
      if (!active) return;
      setFilters(stored); setStats(readStats()); setHydrated(true);
    });
    void Promise.resolve().then(() => { if (active) return refreshConnection(); });
    return () => { active = false; };
  }, [refreshConnection]);

  useEffect(() => {
    if (!hydrated || !connected) return;
    let saved: SavedRound | null = null;
    try { saved = JSON.parse(migrateStorageKey("round") ?? "null") as SavedRound | null; } catch { /* new round */ }
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
      if (error instanceof PlaybackRequestError && error.code === "track_unavailable") {
        setNotice("That track is unavailable here. Choosing another…");
        void player.resetPlayback().then(() => fetch(`/api/game/round/${round.id}/unavailable`, { method: "POST" }))
          .then(async (response) => {
            const payload = await response.json() as RoundView & { error?: string; code?: string };
            if (response.status === 409 && payload.code === "pool_exhausted") {
              setRound(null); setExhaustedPool(filters); setNotice(null);
              localStorage.removeItem(STORAGE_KEYS.round);
              return;
            }
            if (!response.ok) throw new Error(payload.error);
            setRound(payload); setExhaustedPool(null); setNotice(null);
          })
          .catch((replacementError: unknown) => setNotice(replacementError instanceof Error ? replacementError.message : "No replacement was available"));
      } else setNotice(error instanceof Error ? error.message : "Playback failed");
    });
  }, [filters, loadingRound, player, round]);

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
    setAttemptBusy(true); setNotice(null); await player.resetPlayback();
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
    setFilters(next); localStorage.setItem(STORAGE_KEYS.filters, JSON.stringify(next));
    setPendingFilters(null); void newRound(next);
  };

  const requestFilters = (next: Filters) => {
    if (round && !round.finished) setPendingFilters(next);
    else applyFilters(next);
  };

  const modalOpen = Boolean((round?.finished && round.answer) || pendingFilters);

  return (
    <>
    <main className="game-shell" inert={modalOpen || undefined}>
      <header className="site-header">
        <div><span className="wordmark-mark" aria-hidden="true" /><h1>spodle</h1></div>
        {connected && <button className="connection" type="button" onClick={() => void fetch("/api/auth/logout", { method: "POST" }).then(() => location.reload())}><span />Spotify</button>}
      </header>

      <section className="game" aria-busy={loadingRound}>
        <div className="game-heading">
          <p>Unlimited song guessing</p>
          <FilterBar category={filters.category} difficulty={filters.difficulty} disabled={!connected || loadingRound} onChange={requestFilters} />
        </div>

        {connection === "checking" ? (
          <div className="connect-state connect-state--loading" role="status">
            <span className="connect-disc" aria-hidden="true" />
            <p>Checking Spotify connection…</p>
          </div>
        ) : connection === "error" ? (
          <div className="connect-state" role="alert">
            <span className="connect-disc" aria-hidden="true" />
            <h2>Could not check Spotify connection</h2>
            <p>The request did not complete. Check the development server and try again.</p>
            <button className="connect-button" type="button" onClick={() => void refreshConnection()}>Try again</button>
          </div>
        ) : !connected ? (
          <div className="connect-state">
            <span className="connect-disc" aria-hidden="true" />
            <h2>Connect Spotify to play</h2>
            <p>A Spotify Premium account is required for full-track browser playback.</p>
            <a href="/api/auth/spotify">Connect Spotify</a>
          </div>
        ) : exhaustedPool ? (
          <div className="connect-state pool-cleared" role="status">
            <span className="connect-disc" aria-hidden="true" />
            <h2>You cleared this set.</h2>
            <p>You&apos;ve heard every available {getCategory(exhaustedPool.category)?.label ?? exhaustedPool.category} · {DIFFICULTY_LABELS[exhaustedPool.difficulty]} track. Switch the category or difficulty to keep digging.</p>
          </div>
        ) : (
          <>
            <AttemptList attempts={round?.attempts ?? []} currentAttempt={round?.attempt ?? 0} finished={round?.finished ?? false} />
            <DurationBar attempt={round?.attempt ?? 0} progressMs={player.progressMs} />
            <div className="play-area">
              <PlayButton playing={player.playing} disabled={!round || round.finished || !player.ready || loadingRound} onClick={play} />
              <p>{loadingRound ? "Choosing a song…" : player.status === "loading" ? "Preparing Spotify…" : player.status === "offline" ? "Player offline" : `Play ${round?.snippetLength ?? 0.1}s intro`}</p>
            </div>
            <GuessSearch disabled={!round || round.finished || loadingRound} busy={attemptBusy} finalAttempt={round?.attempt === MAX_ATTEMPTS - 1} onAttempt={(guess) => void attempt(guess)} />
          </>
        )}

        {authNotice && <div className={`notice${authNotice.success ? " notice--success" : ""}`} role="status">{authNotice.text}</div>}
        {(notice || player.error) && <div className="notice" role="status">{notice ?? player.error}</div>}
        {connected && !loadingRound && !round && !exhaustedPool && <button className="retry-button" type="button" onClick={() => void newRound(filters)}>Try again</button>}
      </section>

      <StatsSummary stats={stats} />
      <footer><span>Six chances. No daily limit.</span><span>Space to play</span></footer>

    </main>
    {round?.finished && round.answer && <ResultPanel won={round.won} attempts={round.attempts.length} answer={round.answer} onNext={() => void newRound(filters)} />}
    {pendingFilters && <ConfirmDialog onCancel={() => setPendingFilters(null)} onConfirm={() => applyFilters(pendingFilters)} />}
    </>
  );
}
