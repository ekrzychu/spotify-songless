import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_SNIPPET_TRANSPORT_MS,
  PAUSE_CONFIRM_INTERVAL_MS,
  PLAYBACK_START_TIMEOUT_MS,
  PlaybackStartTimeoutError,
  SnippetPlaybackController,
  logicalProgressForTransport,
  snippetTiming,
  spotifyPlaybackStartPayload,
  type SnippetPlayerState,
} from "@/lib/spotify/snippet-playback";

const URI = "spotify:track:0123456789012345678901";
const OTHER_URI = "spotify:track:1111111111111111111111";

describe("snippet playback synchronization", () => {
  let state: SnippetPlayerState | null;
  let controller: SnippetPlaybackController;
  let pause: ReturnType<typeof vi.fn>;
  let resume: ReturnType<typeof vi.fn>;
  let seek: ReturnType<typeof vi.fn>;
  let getVolume: ReturnType<typeof vi.fn>;
  let setVolume: ReturnType<typeof vi.fn>;
  let primeTrack: ReturnType<typeof vi.fn>;
  let playing: boolean[];
  let progress: number[];
  let stopErrors: string[];
  let volume: number;

  function publish(next: SnippetPlayerState): void {
    state = next;
    controller.handleState(next);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    state = { paused: true, position: 0, track_window: { current_track: { uri: OTHER_URI } } };
    volume = 0.65;
    playing = [];
    progress = [];
    stopErrors = [];
    pause = vi.fn(async () => {
      if (state) publish({ ...state, paused: true });
    });
    resume = vi.fn(async () => {
      if (state) publish({ ...state, paused: false });
    });
    seek = vi.fn(async (positionMs: number) => {
      if (state) publish({ ...state, position: positionMs });
    });
    getVolume = vi.fn(async () => volume);
    setVolume = vi.fn(async (nextVolume: number) => { volume = nextVolume; });
    controller = new SnippetPlaybackController({
      activateElement: vi.fn(async () => undefined),
      pause,
      resume,
      seek,
      getCurrentState: vi.fn(async () => state),
      getVolume,
      setVolume,
    }, {
      onPlaying: (value) => playing.push(value),
      onProgress: (value) => progress.push(value),
      onStopError: (value) => stopErrors.push(value),
    }, () => Date.now());
    primeTrack = vi.fn(async () => {
      publish({ paused: false, position: 0, track_window: { current_track: { uri: URI } } });
    });
  });

  afterEach(() => vi.useRealTimers());

  async function requestPlay(
    logicalDurationMs = 100,
    prime = primeTrack,
  ): Promise<{ started: Promise<void> }> {
    const started = controller.play({ spotifyUri: URI, logicalDurationMs, primeTrack: prime });
    await vi.advanceTimersByTimeAsync(0);
    return { started };
  }

  async function finishPreparation(started: Promise<void>): Promise<void> {
    await vi.advanceTimersByTimeAsync(PAUSE_CONFIRM_INTERVAL_MS);
    await started;
  }

  async function finishFirstSnippet(): Promise<void> {
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS + PAUSE_CONFIRM_INTERVAL_MS);
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

  it("first play primes a new track before starting the controlled local snippet", async () => {
    const delayedPrime = vi.fn(async () => undefined);
    const { started } = await requestPlay(100, delayedPrime);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(delayedPrime).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
    expect(progress.at(-1)).toBe(0);
    expect(volume).toBe(0);

    publish({ paused: false, position: 240, track_window: { current_track: { uri: URI } } });
    await finishPreparation(started);
    expect(pause).toHaveBeenCalledTimes(2);
    expect(seek).toHaveBeenCalledTimes(2);
    expect(seek).toHaveBeenNthCalledWith(1, 0);
    expect(seek).toHaveBeenNthCalledWith(2, 0);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(volume).toBe(0.65);
    expect(playing.at(-1)).toBe(true);

    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS - 1);
    expect(pause).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(pause).toHaveBeenCalledTimes(3);
    expect(progress.at(-1)).toBe(100);
    await vi.advanceTimersByTimeAsync(PAUSE_CONFIRM_INTERVAL_MS);
  });

  it("first play and replay use the same snippet lifecycle after initial priming", async () => {
    const { started: first } = await requestPlay();
    await finishPreparation(first);
    await finishFirstSnippet();

    const { started: replay } = await requestPlay();
    await finishPreparation(replay);
    expect(primeTrack).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledTimes(3);
    expect(seek.mock.calls.every(([positionMs]) => positionMs === 0)).toBe(true);
    expect(resume).toHaveBeenCalledTimes(2);
    await finishFirstSnippet();
    expect(progress.at(-1)).toBe(100);
  });

  it("mutes only the remote prime phase and restores local volume before resume", async () => {
    const { started } = await requestPlay();
    await finishPreparation(started);
    expect(getVolume).toHaveBeenCalledTimes(1);
    expect(setVolume.mock.calls).toEqual([[0], [0.65]]);
    expect(setVolume.mock.invocationCallOrder[1]).toBeLessThan(resume.mock.invocationCallOrder[0]!);
  });

  it("does not start timing until local resume is confirmed as playing", async () => {
    resume.mockImplementation(async () => undefined);
    const { started } = await requestPlay();
    await vi.advanceTimersByTimeAsync(PAUSE_CONFIRM_INTERVAL_MS + 1_000);
    expect(playing.at(-1)).toBe(false);
    expect(progress.at(-1)).toBe(0);
    expect(pause).toHaveBeenCalledTimes(2);

    publish({ paused: false, position: 0, track_window: { current_track: { uri: URI } } });
    await started;
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS);
    expect(pause).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(PAUSE_CONFIRM_INTERVAL_MS);
  });

  it("defensively primes again if Spotify changed the loaded URI externally", async () => {
    const { started: first } = await requestPlay();
    await finishPreparation(first);
    await finishFirstSnippet();
    publish({ paused: true, position: 0, track_window: { current_track: { uri: OTHER_URI } } });

    const { started: second } = await requestPlay();
    await finishPreparation(second);
    expect(primeTrack).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it("explicit arm invalidation forces the next play to prime again", async () => {
    const { started: first } = await requestPlay();
    await finishPreparation(first);
    await finishFirstSnippet();
    controller.invalidateArm();

    const { started: second } = await requestPlay();
    await finishPreparation(second);
    expect(primeTrack).toHaveBeenCalledTimes(2);
  });

  it("retries deadline pause while the requested track remains playing", async () => {
    const { started } = await requestPlay();
    await finishPreparation(started);
    const pauseCountBeforeDeadline = pause.mock.calls.length;
    pause.mockImplementation(async () => {
      if (pause.mock.calls.length >= pauseCountBeforeDeadline + 2 && state) publish({ ...state, paused: true });
    });
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS + (PAUSE_CONFIRM_INTERVAL_MS * 2));
    expect(pause).toHaveBeenCalledTimes(pauseCountBeforeDeadline + 2);
    expect(stopErrors).toEqual([]);
  });

  it("bounds deadline pause retries and reports a genuine failure", async () => {
    const { started } = await requestPlay();
    await finishPreparation(started);
    const pauseCountBeforeDeadline = pause.mock.calls.length;
    pause.mockImplementation(async () => undefined);
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS + 500);
    expect(pause).toHaveBeenCalledTimes(pauseCountBeforeDeadline + 3);
    expect(stopErrors).toHaveLength(1);
  });

  it("a stale stop generation cannot retry against a newer local playback", async () => {
    const { started: first } = await requestPlay();
    await finishPreparation(first);
    pause.mockImplementation(async () => undefined);
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS);
    const pauseCountAtDeadline = pause.mock.calls.length;

    pause.mockImplementation(async () => {
      if (state) publish({ ...state, paused: true });
    });
    const { started: replay } = await requestPlay(1_000);
    await finishPreparation(replay);
    expect(pause).toHaveBeenCalledTimes(pauseCountAtDeadline + 1);
    expect(stopErrors).toEqual([]);
  });

  it("resets progress when an active snippet is stopped", async () => {
    const { started } = await requestPlay(1_000);
    await finishPreparation(started);
    await vi.advanceTimersByTimeAsync(300);
    expect(progress.at(-1)).toBeGreaterThanOrEqual(300);
    const stopping = controller.stop(true);
    await vi.advanceTimersByTimeAsync(PAUSE_CONFIRM_INTERVAL_MS);
    await stopping;
    expect(progress.at(-1)).toBe(0);
  });

  it("bounds a remote prime that never makes the requested URI current", async () => {
    const { started } = await requestPlay(100, vi.fn(async () => undefined));
    const rejection = expect(started).rejects.toBeInstanceOf(PlaybackStartTimeoutError);
    await vi.advanceTimersByTimeAsync(PLAYBACK_START_TIMEOUT_MS);
    await rejection;
    expect(volume).toBe(0.65);
    expect(resume).not.toHaveBeenCalled();
  });

  it("builds a position-zero request for the one remote prime", () => {
    expect(spotifyPlaybackStartPayload("device", URI)).toEqual({
      deviceId: "device",
      spotifyUri: URI,
      positionMs: 0,
    });
  });
});
