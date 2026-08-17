import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_SNIPPET_TRANSPORT_MS,
  PAUSE_CONFIRM_INTERVAL_MS,
  PLAYBACK_START_TIMEOUT_MS,
  PRIME_SETTLE_MS,
  PlaybackStartTimeoutError,
  SnippetPlaybackController,
  logicalProgressForTransport,
  snippetTiming,
  spotifyPlaybackStartPayload,
  type SnippetPlayerState,
} from "@/lib/spotify/snippet-playback";

const URI = "spotify:track:0123456789012345678901";
const OTHER_URI = "spotify:track:1111111111111111111111";
const REMOTE_DELAY_MS = 30;
const OPERATION_DELAY_MS = 30;
type PlaybackPhase = ReturnType<SnippetPlaybackController["getDebugSnapshot"]>["phase"];

describe("snippet playback synchronization", () => {
  let state: SnippetPlayerState | null;
  let controller: SnippetPlaybackController;
  let pause: ReturnType<typeof vi.fn>;
  let resume: ReturnType<typeof vi.fn>;
  let seek: ReturnType<typeof vi.fn>;
  let primeTrack: ReturnType<typeof vi.fn>;
  let playing: boolean[];
  let progress: number[];
  let stopErrors: string[];

  function publish(next: SnippetPlayerState): void {
    state = next;
    controller.handleState(next);
  }

  function delayedPublish(update: (current: SnippetPlayerState) => SnippetPlayerState): void {
    setTimeout(() => {
      if (state) publish(update(state));
    }, OPERATION_DELAY_MS);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    state = { paused: true, position: 0, track_window: { current_track: { uri: OTHER_URI } } };
    playing = [];
    progress = [];
    stopErrors = [];
    pause = vi.fn(async () => delayedPublish((current) => ({ ...current, paused: true })));
    resume = vi.fn(async () => delayedPublish((current) => ({ ...current, paused: false })));
    seek = vi.fn(async (positionMs: number) => delayedPublish((current) => ({ ...current, position: positionMs })));
    controller = new SnippetPlaybackController({
      activateElement: vi.fn(async () => undefined),
      pause,
      resume,
      seek,
      getCurrentState: vi.fn(async () => state),
    }, {
      onPlaying: (value) => playing.push(value),
      onProgress: (value) => progress.push(value),
      onStopError: (value) => stopErrors.push(value),
    }, () => Date.now());
    primeTrack = vi.fn(async (signal: AbortSignal) => {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          publish({ paused: false, position: 0, track_window: { current_track: { uri: URI } } });
          resolve();
        }, REMOTE_DELAY_MS);
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    });
  });

  afterEach(() => vi.useRealTimers());

  function requestPlay(logicalDurationMs = 100, prime = primeTrack): Promise<void> {
    return controller.play({ spotifyUri: URI, logicalDurationMs, primeTrack: prime });
  }

  async function advanceUntilPhase(target: PlaybackPhase, limitMs = 1_000): Promise<void> {
    for (let elapsed = 0; elapsed <= limitMs; elapsed += 5) {
      if (controller.getDebugSnapshot().phase === target) return;
      await vi.advanceTimersByTimeAsync(5);
    }
    throw new Error(`Playback never reached phase ${target}; current phase is ${controller.getDebugSnapshot().phase}`);
  }

  async function finishPreparation(started: Promise<void>): Promise<void> {
    await advanceUntilPhase("snippet-playing");
    await started;
  }

  async function finishFirstSnippet(): Promise<void> {
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS + PAUSE_CONFIRM_INTERVAL_MS + OPERATION_DELAY_MS);
  }

  it("maps the logical 100ms attempt onto a 350ms Spotify transport window", () => {
    const timing = snippetTiming(100);
    expect(timing).toEqual({ logicalDurationMs: 100, transportDurationMs: FIRST_SNIPPET_TRANSPORT_MS });
    expect(logicalProgressForTransport(0, timing)).toBe(0);
    expect(logicalProgressForTransport(175, timing)).toBe(50);
    expect(logicalProgressForTransport(350, timing)).toBe(100);
    expect(logicalProgressForTransport(500, timing)).toBe(100);
  });

  it.each([1_000, 2_000, 5_000, 10_000, 15_000])("leaves the %dms transport duration unchanged", (durationMs) => {
    expect(snippetTiming(durationMs)).toEqual({ logicalDurationMs: durationMs, transportDurationMs: durationMs });
  });

  it("tolerates asynchronous remote, pause, seek, and resume state transitions", async () => {
    const started = requestPlay();
    await advanceUntilPhase("waiting-for-uri");
    expect(controller.getDebugSnapshot().armedUri).toBeNull();
    await finishPreparation(started);

    expect(primeTrack).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledExactlyOnceWith(0);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(controller.getDebugSnapshot()).toMatchObject({
      phase: "snippet-playing",
      requestedUri: URI,
      armedUri: URI,
    });
    expect(playing.at(-1)).toBe(true);
  });

  it("waits for the centralized prime settle period before pausing", async () => {
    const started = requestPlay();
    await vi.advanceTimersByTimeAsync(REMOTE_DELAY_MS + PRIME_SETTLE_MS - 1);
    expect(pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(pause).toHaveBeenCalledTimes(1);
    await finishPreparation(started);
  });

  it("replays locally with one seek and no additional remote load", async () => {
    const first = requestPlay();
    await finishPreparation(first);
    await finishFirstSnippet();

    const replay = requestPlay();
    expect(progress.at(-1)).toBe(0);
    await finishPreparation(replay);
    expect(primeTrack).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledTimes(2);
    expect(seek.mock.calls.every(([positionMs]) => positionMs === 0)).toBe(true);
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it("starts timing only after local resume is confirmed playing", async () => {
    resume.mockImplementation(async () => undefined);
    const started = requestPlay();
    await advanceUntilPhase("snippet-resuming");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(playing.at(-1)).toBe(false);
    expect(progress.at(-1)).toBe(0);

    publish({ paused: false, position: 0, track_window: { current_track: { uri: URI } } });
    await started;
    expect(controller.getDebugSnapshot().phase).toBe("snippet-playing");
  });

  it("defensively primes again if Spotify changed the loaded URI externally", async () => {
    const first = requestPlay();
    await finishPreparation(first);
    await finishFirstSnippet();
    publish({ paused: true, position: 0, track_window: { current_track: { uri: OTHER_URI } } });

    const second = requestPlay();
    await finishPreparation(second);
    expect(primeTrack).toHaveBeenCalledTimes(2);
  });

  it("retries deadline pause while the requested track remains playing", async () => {
    const started = requestPlay();
    await finishPreparation(started);
    const pausesBeforeDeadline = pause.mock.calls.length;
    pause.mockImplementation(async () => {
      if (pause.mock.calls.length >= pausesBeforeDeadline + 2) delayedPublish((current) => ({ ...current, paused: true }));
    });
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS + (PAUSE_CONFIRM_INTERVAL_MS * 3));
    expect(pause).toHaveBeenCalledTimes(pausesBeforeDeadline + 2);
    expect(stopErrors).toEqual([]);
  });

  it("bounds deadline pause retries and reports a genuine failure", async () => {
    const started = requestPlay();
    await finishPreparation(started);
    const pausesBeforeDeadline = pause.mock.calls.length;
    pause.mockImplementation(async () => undefined);
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS + 500);
    expect(pause).toHaveBeenCalledTimes(pausesBeforeDeadline + 3);
    expect(stopErrors).toHaveLength(1);
  });

  it("a stale snippet stop cannot pause a newer run", async () => {
    const first = requestPlay();
    await finishPreparation(first);
    pause.mockImplementation(async () => undefined);
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS);
    const pausesAtDeadline = pause.mock.calls.length;

    pause.mockImplementation(async () => delayedPublish((current) => ({ ...current, paused: true })));
    const replay = requestPlay(1_000);
    await finishPreparation(replay);
    expect(pause).toHaveBeenCalledTimes(pausesAtDeadline + 1);
    expect(stopErrors).toEqual([]);
  });

  it("bounds a remote load that never makes the requested URI current", async () => {
    const started = requestPlay(100, vi.fn(async () => undefined));
    const rejection = expect(started).rejects.toBeInstanceOf(PlaybackStartTimeoutError);
    await vi.advanceTimersByTimeAsync(PLAYBACK_START_TIMEOUT_MS);
    await rejection;
    expect(resume).not.toHaveBeenCalled();
    expect(controller.getDebugSnapshot()).toMatchObject({ phase: "failed", armedUri: null });
  });

  it.each([
    ["prime-pausing", "pausing"],
    ["prime-seeking", "seeking"],
    ["snippet-resuming", "resuming"],
  ] as const)("honors Spotify disallows.%s state restrictions", async (targetPhase, restriction) => {
    const originalPublish = publish;
    primeTrack = vi.fn(async () => {
      const disallows = { [restriction]: true };
      originalPublish({ paused: false, position: 0, disallows, track_window: { current_track: { uri: URI } } });
    });
    if (restriction === "seeking") pause.mockImplementation(async () => delayedPublish((current) => ({ ...current, paused: true })));
    if (restriction === "resuming") {
      pause.mockImplementation(async () => delayedPublish((current) => ({ ...current, paused: true })));
      seek.mockImplementation(async () => delayedPublish((current) => ({ ...current, position: 0 })));
    }
    const started = requestPlay(100, primeTrack);
    const rejection = expect(started).rejects.toThrow(new RegExp(`disallows .*phase ${targetPhase}`));
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(controller.getDebugSnapshot()).toMatchObject({ phase: "failed", armedUri: null });
  });

  it.each([
    ["prime-seeking", "seek", "Mock seek rejection"],
    ["snippet-resuming", "resume", "Mock resume rejection"],
  ] as const)("invalidates the arm when %s fails", async (targetPhase, operation, message) => {
    const failing = vi.fn(async () => { throw new Error(message); });
    if (operation === "seek") seek = failing;
    else resume = failing;
    controller = new SnippetPlaybackController({
      activateElement: vi.fn(async () => undefined), pause, resume, seek,
      getCurrentState: vi.fn(async () => state),
    }, {
      onPlaying: (value) => playing.push(value), onProgress: (value) => progress.push(value),
    }, () => Date.now());

    const started = requestPlay();
    const rejection = expect(started).rejects.toThrow(message);
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(failing).toHaveBeenCalledTimes(1);
    expect(controller.getDebugSnapshot()).toMatchObject({ phase: "failed", armedUri: null });
    expect(playing.at(-1)).toBe(false);
    expect(targetPhase).toContain(operation === "seek" ? "seeking" : "resuming");
  });

  it.each(["remote-loading", "prime-pausing", "prime-seeking", "snippet-resuming"] as const)(
    "preserves SDK errors and aborts without a competing stop during %s",
    async (targetPhase) => {
      if (targetPhase === "prime-seeking") {
        seek.mockImplementation(async () => undefined);
        primeTrack = vi.fn(async () => {
          await new Promise<void>((resolve) => setTimeout(() => {
            publish({ paused: false, position: 240, track_window: { current_track: { uri: URI } } });
            resolve();
          }, REMOTE_DELAY_MS));
        });
      }
      const started = requestPlay();
      await advanceUntilPhase(targetPhase);
      const pausesAtFailure = pause.mock.calls.length;
      const failure = controller.failFromSdk("Mock Spotify playback failure");
      expect(failure).toMatchObject({ phase: targetPhase, message: "Mock Spotify playback failure", requestedUri: URI });
      expect(controller.getDebugSnapshot()).toEqual({
        phase: "failed", requestedUri: URI, armedUri: null, sdkError: "Mock Spotify playback failure",
      });
      expect(playing.at(-1)).toBe(false);
      await vi.advanceTimersByTimeAsync(PLAYBACK_START_TIMEOUT_MS + 1_000);
      await started;
      expect(pause).toHaveBeenCalledTimes(pausesAtFailure);
      expect(playing.at(-1)).toBe(false);
    },
  );

  it("resets progress when an active snippet is stopped", async () => {
    const started = requestPlay(1_000);
    await finishPreparation(started);
    await vi.advanceTimersByTimeAsync(300);
    expect(progress.at(-1)).toBeGreaterThanOrEqual(300);
    const stopping = controller.stop(true);
    await vi.advanceTimersByTimeAsync(PAUSE_CONFIRM_INTERVAL_MS + OPERATION_DELAY_MS);
    await stopping;
    expect(progress.at(-1)).toBe(0);
  });

  it("builds a position-zero request for the only remote load", () => {
    expect(spotifyPlaybackStartPayload("device", URI)).toEqual({
      deviceId: "device",
      spotifyUri: URI,
      positionMs: 0,
    });
  });
});
