import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAUSE_CONFIRM_TIMEOUT_MS,
  PLAYBACK_START_TIMEOUT_MS,
  STABLE_START_WINDOW_MS,
  PlaybackStartTimeoutError,
  PlaybackTransportFaultError,
  SnippetPlaybackController,
  logicalProgressForTransport,
  snippetTiming,
  spotifyPlaybackStartPayload,
  type SnippetPlayerState,
} from "@/lib/spotify/snippet-playback";

const URI = "spotify:track:0123456789012345678901";
const OTHER_URI = "spotify:track:1111111111111111111111";
const OPERATION_DELAY_MS = 20;

describe("audio-gated Spotify snippet transport", () => {
  let state: SnippetPlayerState;
  let controller: SnippetPlaybackController;
  let operations: string[];
  let volume: ReturnType<typeof vi.fn>;
  let pause: ReturnType<typeof vi.fn>;
  let resume: ReturnType<typeof vi.fn>;
  let seek: ReturnType<typeof vi.fn>;
  let primeTrack: ReturnType<typeof vi.fn>;
  let playing: boolean[];
  let progress: number[];
  let errors: string[];
  let advancePosition: boolean;
  let positionEpoch: number;
  let positionBase: number;

  function publish(next: SnippetPlayerState): void {
    state = next;
    controller.handleState(next);
  }

  function beginPlaying(uri = URI): void {
    positionEpoch = Date.now();
    positionBase = state.position;
    publish({ ...state, paused: false, track_window: { current_track: { uri } } });
  }

  function currentState(): SnippetPlayerState {
    if (!state.paused && advancePosition) {
      state = { ...state, position: positionBase + Date.now() - positionEpoch };
    }
    return state;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    state = { paused: true, position: 0, track_window: { current_track: { uri: OTHER_URI } } };
    operations = [];
    playing = [];
    progress = [];
    errors = [];
    advancePosition = true;
    positionEpoch = 0;
    positionBase = 0;
    volume = vi.fn(async (value: number) => { operations.push(`volume:${value}`); });
    pause = vi.fn(async () => {
      operations.push("pause");
      setTimeout(() => publish({ ...currentState(), paused: true }), OPERATION_DELAY_MS);
    });
    resume = vi.fn(async () => {
      operations.push("resume");
      setTimeout(() => beginPlaying(), OPERATION_DELAY_MS);
    });
    seek = vi.fn(async (position: number) => {
      operations.push(`seek:${position}`);
      setTimeout(() => publish({ ...state, position }), OPERATION_DELAY_MS);
    });
    controller = new SnippetPlaybackController({
      pause,
      resume,
      seek,
      setVolume: volume,
      getCurrentState: vi.fn(async () => currentState()),
    }, {
      onPlaying: (value) => playing.push(value),
      onProgress: (value) => progress.push(value),
      onStopError: (message) => errors.push(message),
    }, () => Date.now());
    primeTrack = vi.fn(async () => {
      operations.push("remote-play");
      beginPlaying();
    });
  });

  afterEach(() => vi.useRealTimers());

  function request(durationMs = 100): Promise<void> {
    return controller.play({ spotifyUri: URI, logicalDurationMs: durationMs, primeTrack });
  }

  async function prepare(durationMs = 100): Promise<void> {
    const started = request(durationMs);
    for (let elapsed = 0; elapsed < 1_500 && controller.getDebugSnapshot().phase !== "snippet-playing"; elapsed += 5) {
      await vi.advanceTimersByTimeAsync(5);
    }
    await started;
    expect(controller.getDebugSnapshot().phase).toBe("snippet-playing");
  }

  it("uses the logical 100ms duration as the real audible cutoff", () => {
    expect(snippetTiming(100)).toEqual({ logicalDurationMs: 100, transportDurationMs: 100 });
    expect(logicalProgressForTransport(50, snippetTiming(100))).toBe(50);
    expect(logicalProgressForTransport(350, snippetTiming(100))).toBe(100);
  });

  it.each([1_000, 2_000, 5_000, 10_000, 15_000])("keeps the %dms endpoint unchanged", (durationMs) => {
    expect(snippetTiming(durationMs).transportDurationMs).toBe(durationMs);
  });

  it("runs a silent stable warm-up before pause, seek, volume restore, and resume", async () => {
    await controller.setUserVolume(0.65);
    operations = [];
    await prepare();
    expect(operations).toEqual([
      "volume:0", "remote-play", "pause", "seek:0", "volume:0.65", "resume",
    ]);
  });

  it("rejects a transient forward state that resets before stable playback", async () => {
    advancePosition = false;
    primeTrack = vi.fn(async () => {
      operations.push("remote-play");
      publish({ paused: false, position: 0, track_window: { current_track: { uri: URI } } });
    });
    const origin = Date.now();
    const getCurrentState = vi.fn(async () => {
      const elapsed = Date.now() - origin;
      const position = elapsed < 300 ? elapsed : elapsed - 300;
      state = { ...state, position };
      return state;
    });
    controller = new SnippetPlaybackController({ pause, resume, seek, setVolume: volume, getCurrentState }, {
      onPlaying: (value) => playing.push(value), onProgress: (value) => progress.push(value),
    }, () => Date.now());
    const started = request();
    await vi.advanceTimersByTimeAsync(700);
    expect(pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    await started;
    expect(pause.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("mutes at 100ms even while pause confirmation is still pending", async () => {
    await prepare();
    const volumeCalls = volume.mock.calls.length;
    pause.mockImplementation(async () => { operations.push("pause"); });
    await vi.advanceTimersByTimeAsync(100);
    expect(volume.mock.calls[volumeCalls]).toEqual([0]);
    expect(controller.getDebugSnapshot()).toMatchObject({ phase: "snippet-pausing", transportMuted: true });
    expect(playing.at(-1)).toBe(false);
  });

  it("stays muted and blocks new playback when pause cannot be confirmed", async () => {
    await prepare();
    pause.mockImplementation(async () => { operations.push("pause"); });
    await vi.advanceTimersByTimeAsync(100 + PAUSE_CONFIRM_TIMEOUT_MS + 100);
    expect(controller.getDebugSnapshot()).toMatchObject({ phase: "failed", transportMuted: true, transportFaulted: true });
    expect(volume.mock.calls.at(-1)).toEqual([0]);
    expect(errors).toHaveLength(1);
    await expect(request()).rejects.toBeInstanceOf(PlaybackTransportFaultError);
  });

  it("repairs a failed silent transport through bounded local pause only", async () => {
    await prepare();
    pause.mockImplementation(async () => undefined);
    await vi.advanceTimersByTimeAsync(100 + PAUSE_CONFIRM_TIMEOUT_MS + 100);
    pause.mockImplementation(async () => {
      setTimeout(() => publish({ ...state, paused: true }), OPERATION_DELAY_MS);
    });
    const repair = controller.stop();
    await vi.advanceTimersByTimeAsync(300);
    await expect(repair).resolves.toBe(true);
    expect(controller.getDebugSnapshot()).toMatchObject({ transportMuted: false, transportFaulted: false });
    expect(volume.mock.calls.at(-1)).toEqual([0.65]);
  });

  it("replay seeks to zero without another remote load", async () => {
    await prepare();
    await vi.advanceTimersByTimeAsync(400);
    const replay = request(1_000);
    await vi.advanceTimersByTimeAsync(400);
    await replay;
    expect(primeTrack).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledTimes(2);
    expect(seek.mock.calls.every(([position]) => position === 0)).toBe(true);
  });

  it("extends a playing 100ms snippet to the absolute 1s endpoint without restart", async () => {
    await prepare();
    const resumeCalls = resume.mock.calls.length;
    const seekCalls = seek.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60);
    expect(controller.extendActiveSnippet(1_000)).toBe(true);
    await vi.advanceTimersByTimeAsync(939);
    expect(controller.getDebugSnapshot().phase).toBe("snippet-playing");
    await vi.advanceTimersByTimeAsync(1);
    expect(volume.mock.calls.at(-1)).toEqual([0]);
    expect(resume).toHaveBeenCalledTimes(resumeCalls);
    expect(seek).toHaveBeenCalledTimes(seekCalls);
  });

  it("extends 1s to absolute 2s and handles rapid monotonic extensions", async () => {
    await prepare(1_000);
    await vi.advanceTimersByTimeAsync(400);
    expect(controller.extendActiveSnippet(2_000)).toBe(true);
    expect(controller.extendActiveSnippet(5_000)).toBe(true);
    expect(controller.extendActiveSnippet(2_000)).toBe(false);
    await vi.advanceTimersByTimeAsync(4_599);
    expect(controller.getDebugSnapshot().phase).toBe("snippet-playing");
    await vi.advanceTimersByTimeAsync(1);
    expect(volume.mock.calls.at(-1)).toEqual([0]);
  });

  it("does not extend or autoplay while paused", async () => {
    expect(controller.extendActiveSnippet(1_000)).toBe(false);
    expect(resume).not.toHaveBeenCalled();
  });

  it("restores the newest user volume selected while transport-muted", async () => {
    await prepare();
    pause.mockImplementation(async () => {
      setTimeout(() => publish({ ...state, paused: true }), 200);
    });
    await vi.advanceTimersByTimeAsync(100);
    await controller.setUserVolume(0.3);
    expect(volume.mock.calls.at(-1)).toEqual([0]);
    await vi.advanceTimersByTimeAsync(400);
    expect(volume.mock.calls.at(-1)).toEqual([0.3]);
  });

  it("bounds a remote load that never stabilizes", async () => {
    primeTrack = vi.fn(async () => undefined);
    const started = request();
    const rejected = expect(started).rejects.toBeInstanceOf(PlaybackStartTimeoutError);
    await vi.advanceTimersByTimeAsync(PLAYBACK_START_TIMEOUT_MS + STABLE_START_WINDOW_MS);
    await rejected;
  });

  it("builds the only remote command at position zero", () => {
    expect(spotifyPlaybackStartPayload("device", URI)).toEqual({ deviceId: "device", spotifyUri: URI, positionMs: 0 });
  });
});
