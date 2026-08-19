"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AttemptList } from "@/components/game/attempt-list";
import { DurationBar } from "@/components/game/duration-bar";
import { StageProgress } from "@/components/game/stage-progress";
import { FilterBar } from "@/components/game/filter-bar";
import { GuessSearch } from "@/components/game/guess-search";
import { PlayButton } from "@/components/game/play-button";
import { ResultPanel } from "@/components/game/result-panel";
import { StatsSummary } from "@/components/game/stats-summary";
import { ConfirmDialog } from "@/components/game/confirm-dialog";
import { VolumeControl } from "@/components/game/volume-control";
import { DEFAULT_FILTERS, normalizeStoredFilters, type GameFilters } from "@/lib/client/filters";
import { EMPTY_STATS, readStats, recordResult, type LocalStats } from "@/lib/client/stats";
import { migrateStorageKey, STORAGE_KEYS } from "@/lib/client/storage";
import { checkSpotifyConnection, oauthNotice, type SpotifyConnectionState } from "@/lib/client/spotify-connection";
import { PlaybackRequestError, artworkUrlForUri, useSpotifyPlayer } from "@/hooks/use-spotify-player";
import { getCategory } from "@/lib/catalog/category-config";
import { GAME_DIFFICULTY_LABELS, nextHigherDifficulty } from "@/lib/game/difficulty";
import { MAX_ATTEMPTS, SNIPPET_LENGTHS } from "@/lib/game/snippets";
import { RESULT_REVEAL_DURATION_SECONDS, shouldStartResultPlayback } from "@/lib/game/result-playback";
import type { GameDifficulty, RoundView, SearchTrack, SetProgressView } from "@/types/game";

type Filters = GameFilters;
type SavedRound = { id: string; category: string; difficulty: GameDifficulty };

export function GameShell() {
  const [connection, setConnection] = useState<SpotifyConnectionState>("checking");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [hydrated, setHydrated] = useState(false);
  const [round, setRound] = useState<RoundView | null>(null);
  const [loadingRound, setLoadingRound] = useState(false);
  const [attemptBusy, setAttemptBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [revealWarning, setRevealWarning] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<{ text: string; success: boolean } | null>(null);
  const [pendingFilters, setPendingFilters] = useState<Filters | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [exhaustedPool, setExhaustedPool] = useState<Filters | null>(null);
  const [setProgress, setSetProgress] = useState<SetProgressView>({ completed: 0, total: 0 });
  const [stats, setStats] = useState<LocalStats>(EMPTY_STATS);
  const [dismissedResultRoundId, setDismissedResultRoundId] = useState<string | null>(null);
  const revealStartedRoundRef = useRef<string | null>(null);
  const finishedNextRef = useRef<HTMLButtonElement>(null);
  const connected = connection === "connected";
  const player = useSpotifyPlayer(connected);
  const resetPlayback = player.resetPlayback;
  const invalidatePlayerArm = player.invalidateArm;

  const newRound = useCallback(async (nextFilters: Filters) => {
    setLoadingRound(true); setNotice(null); setRevealWarning(null); setExhaustedPool(null);
    let playbackStopped = false;
    try {
      if (!await resetPlayback()) throw new Error("Spotify playback could not be stopped. Press Pause and try again.");
      playbackStopped = true;
      const response = await fetch("/api/game/round", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextFilters),
      });
      const payload = await response.json() as RoundView & { error?: string; code?: string };
      if (response.status === 409 && payload.code === "pool_exhausted") {
        setRound(null);
        setDismissedResultRoundId(null);
        setExhaustedPool(nextFilters);
        localStorage.removeItem(STORAGE_KEYS.round);
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "A song could not be loaded");
      setDismissedResultRoundId(null);
      setRound(payload);
      if (payload.setProgress) setSetProgress(payload.setProgress);
      localStorage.setItem(STORAGE_KEYS.round, JSON.stringify({ id: payload.id, ...nextFilters }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "A song could not be loaded";
      if (playbackStopped) setRound(null);
      else setRevealWarning(message);
      setNotice(message);
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
    const rawFilters = migrateStorageKey("filters");
    if (rawFilters !== null) {
      try { stored = normalizeStoredFilters(JSON.parse(rawFilters) as unknown); } catch { stored = DEFAULT_FILTERS; }
      localStorage.setItem(STORAGE_KEYS.filters, JSON.stringify(stored));
    }
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
          const payload = await response.json() as RoundView;
          setRound(payload);
          if (payload.setProgress) setSetProgress(payload.setProgress);
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

  useEffect(() => {
    invalidatePlayerArm();
  }, [invalidatePlayerArm, round?.spotifyUri]);

  const play = useCallback(() => {
    player.activateForUserGesture();
    if (!round || round.finished || loadingRound || player.busy) return;
    if (player.playing) void player.pause();
    else void player.playSnippet(round.spotifyUri, round.snippetLength).catch((error: unknown) => {
      if (error instanceof PlaybackRequestError && error.code === "track_unavailable") {
        setNotice("That track is unavailable here. Choosing another…");
        void player.resetPlayback().then((stopped) => {
          if (!stopped) throw new Error("Spotify playback could not be stopped. Press Pause and try again.");
          return fetch(`/api/game/round/${round.id}/unavailable`, { method: "POST" });
        })
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
    player.activateForUserGesture();
    if (!round || round.finished || attemptBusy) return;
    setAttemptBusy(true); setNotice(null); setRevealWarning(null);
    const continuingSkip = guess === null
      && round.attempt < MAX_ATTEMPTS - 1
      && player.audiblyPlaying;
    try {
      if (continuingSkip) {
        const nextEndpoint = SNIPPET_LENGTHS[round.attempt + 1];
        if (nextEndpoint === undefined || !player.extendSnippet(nextEndpoint)) {
          throw new Error("Spotify playback could not be extended safely.");
        }
      } else if (!await player.resetPlayback()) {
        throw new Error("Spotify playback could not be stopped. Press Pause and try again.");
      }
      const response = await fetch(`/api/game/round/${round.id}/attempt`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guessTrackId: guess?.spotifyTrackId ?? null }),
      });
      const payload = await response.json() as RoundView & { error?: string };
      if (!response.ok) {
        if (continuingSkip) await player.resetPlayback();
        throw new Error(payload.error ?? "The attempt was not recorded");
      }
      const shouldStartReveal = shouldStartResultPlayback(round, payload, revealStartedRoundRef.current);
      setRound(payload);
      if (payload.setProgress) setSetProgress(payload.setProgress);
      if (shouldStartReveal) {
        revealStartedRoundRef.current = payload.id;
        void player.playSnippet(payload.spotifyUri, RESULT_REVEAL_DURATION_SECONDS).catch((playbackError: unknown) => {
          setRevealWarning(playbackError instanceof Error
            ? `Answer playback unavailable: ${playbackError.message}`
            : "Answer playback is unavailable.");
        });
      }
    } catch (error) {
      if (continuingSkip) await player.resetPlayback();
      setNotice(error instanceof Error ? error.message : "The attempt was not recorded");
    }
    finally { setAttemptBusy(false); }
  };

  const resetSetProgress = async () => {
    setConfirmingReset(false);
    setLoadingRound(true); setNotice(null);
    try {
      if (!await player.resetPlayback()) throw new Error("Spotify playback could not be stopped. Press Pause and try again.");
      const response = await fetch("/api/game/progress/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Set progress could not be reset");
      localStorage.removeItem(STORAGE_KEYS.round);
      setRound(null); setExhaustedPool(null); setSetProgress({ completed: 0, total: setProgress.total });
      await newRound(filters);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Set progress could not be reset");
    } finally { setLoadingRound(false); }
  };

  const tryHigherDifficulty = async () => {
    player.activateForUserGesture();
    const difficulty = nextHigherDifficulty(filters.difficulty);
    if (!difficulty) return;
    if (!await player.resetPlayback()) {
      setRevealWarning("Spotify playback could not be stopped. Press Pause and try again.");
      return;
    }
    const next = { category: filters.category, difficulty };
    setFilters(next);
    localStorage.setItem(STORAGE_KEYS.filters, JSON.stringify(next));
    await newRound(next);
  };

  const applyFilters = (next: Filters) => {
    setFilters(next); localStorage.setItem(STORAGE_KEYS.filters, JSON.stringify(next));
    setPendingFilters(null); void newRound(next);
  };

  const requestFilters = (next: Filters) => {
    if (round && !round.finished) setPendingFilters(next);
    else applyFilters(next);
  };

  const showResult = Boolean(
    round?.finished
    && round.answer
    && dismissedResultRoundId !== round.id,
  );
  const modalOpen = Boolean(showResult || pendingFilters || confirmingReset);
  const dismissResult = () => {
    if (!round?.finished) return;
    setDismissedResultRoundId(round.id);
    requestAnimationFrame(() => requestAnimationFrame(() => finishedNextRef.current?.focus()));
  };
  const startNextSong = () => void newRound(filters);
  const currentCategory = getCategory(filters.category)?.label ?? filters.category;
  const currentDifficulty = GAME_DIFFICULTY_LABELS[filters.difficulty];
  const currentSnippetLength = round?.snippetLength ?? 0.1;

  return (
    <div className="app-theme" data-difficulty={filters.difficulty}>
    <main className="game-shell" inert={modalOpen || undefined}>
      <header className="site-header">
        <div><span className="wordmark-mark" aria-hidden="true" /><h1>spodle</h1></div>
        {connected && <button className="connection" type="button" onClick={() => void fetch("/api/auth/logout", { method: "POST" }).then(() => location.reload())}><span />Spotify</button>}
      </header>

      <section className={`game${connected ? " game--connected" : ""}`} aria-busy={loadingRound || player.busy}>
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
            <p className="set-complete-label">Set complete</p>
            <h2>You&apos;ve played every available song.</h2>
            <p>{getCategory(exhaustedPool.category)?.label ?? exhaustedPool.category} · {GAME_DIFFICULTY_LABELS[exhaustedPool.difficulty]}</p>
            <div className="set-complete-actions">
              <button className="connect-button" type="button" onClick={() => setConfirmingReset(true)}>Reset progress</button>
              <button type="button" onClick={() => document.querySelector<HTMLButtonElement>(".filter-control")?.focus()}>Choose another set</button>
            </div>
          </div>
        ) : (
          <>
            <section className="game-primary" aria-label="Song guessing controls">
            <div className="game-context">
              <div><span>Current set</span><strong>{currentCategory} <i aria-hidden="true" /> {currentDifficulty}</strong></div>
              <div className="set-progress">
                <span>Set progress</span>
                <strong>{setProgress.completed} / {setProgress.total}</strong>
                <button type="button" onClick={() => setConfirmingReset(true)}>Reset</button>
              </div>
            </div>
            <div className="play-area">
              <PlayButton playing={player.playing} disabled={!round || round.finished || !player.ready || loadingRound || player.busy} onClick={play} />
              <strong className="snippet-duration">{currentSnippetLength}s</strong>
            </div>
            <DurationBar attempt={round?.attempt ?? 0} progressMs={player.progressMs} />
            {round?.finished && !showResult ? (
              <button ref={finishedNextRef} className="main-next-button" type="button" disabled={loadingRound} onClick={startNextSong}>Next Song</button>
            ) : (
              <GuessSearch disabled={!round || round.finished || loadingRound} busy={attemptBusy} finalAttempt={round?.attempt === MAX_ATTEMPTS - 1} onAttempt={(guess) => void attempt(guess)} />
            )}
            <AttemptList attempts={round?.attempts ?? []} currentAttempt={round?.attempt ?? 0} finished={round?.finished ?? false} />
            </section>
            <section className="stage-panel" aria-labelledby="stages-heading">
              <h2 className="rail-heading" id="stages-heading">Stages</h2>
              <StageProgress attempt={round?.attempt ?? 0} />
            </section>
            <section className="volume-panel" aria-labelledby="volume-heading">
              <h2 className="rail-heading" id="volume-heading">Volume</h2>
              <VolumeControl
                value={player.volumePercent}
                disabled={!player.ready}
                onChange={(value) => void player.setVolume(value)}
              />
            </section>
            <section className="shortcut-panel" aria-labelledby="shortcut-heading">
              <h2 className="rail-heading" id="shortcut-heading">Shortcut</h2>
              <p><kbd>Space</kbd><span>Play / pause</span></p>
            </section>
          </>
        )}

        {authNotice && <div className={`notice${authNotice.success ? " notice--success" : ""}`} role="status">{authNotice.text}</div>}
        {(notice || player.error) && <div className="notice" role="status">{notice ?? player.error}</div>}
        {connected && !loadingRound && !round && !exhaustedPool && <button className="retry-button" type="button" onClick={() => void newRound(filters)}>Try again</button>}
      </section>

      <StatsSummary stats={stats} />
      <footer><span>Six chances. No daily limit.</span><span>Space to play</span></footer>

    </main>
    {showResult && round?.finished && round.answer && <ResultPanel
      won={round.won}
      attempts={round.attempts.length}
      answer={round.answer}
      artworkUrl={artworkUrlForUri(player.currentTrackArtwork, round.spotifyUri)}
      playbackWarning={revealWarning}
      onClose={dismissResult}
      onNext={startNextSong}
      onTryHigher={nextHigherDifficulty(filters.difficulty) ? () => void tryHigherDifficulty() : undefined}
    />}
    {pendingFilters && <ConfirmDialog onCancel={() => setPendingFilters(null)} onConfirm={() => applyFilters(pendingFilters)} />}
    {confirmingReset && <ConfirmDialog
      title="Reset this set?"
      description={`Completed ${currentCategory} · ${currentDifficulty} songs will become selectable again. Catalog and stats are not changed.`}
      cancelLabel="Cancel"
      confirmLabel="Reset progress"
      onCancel={() => setConfirmingReset(false)}
      onConfirm={() => void resetSetProgress()}
    />}
    </div>
  );
}
