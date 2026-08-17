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

describe("snippet playback synchronization", () => {
  let state: SnippetPlayerState | null;
  let pause: ReturnType<typeof vi.fn>;
  let controller: SnippetPlaybackController;
  let playing: boolean[];
  let progress: number[];
  let stopErrors: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    state = { paused: true, position: 0, track_window: { current_track: { uri: URI } } };
    pause = vi.fn(async () => { if (state) state = { ...state, paused: true }; });
    playing = [];
    progress = [];
    stopErrors = [];
    controller = new SnippetPlaybackController({
      activateElement: vi.fn(async () => undefined),
      pause,
      getCurrentState: vi.fn(async () => state),
    }, {
      onPlaying: (value) => playing.push(value),
      onProgress: (value) => progress.push(value),
      onStopError: (value) => stopErrors.push(value),
    }, () => Date.now());
  });

  afterEach(() => vi.useRealTimers());

  async function begin(durationMs: number): Promise<{ started: Promise<void> }> {
    const started = controller.play(URI, durationMs, vi.fn(async () => undefined));
    await vi.advanceTimersByTimeAsync(0);
    return { started };
  }

  function confirmAt(position = 0): void {
    state = { paused: false, position, track_window: { current_track: { uri: URI } } };
    controller.handleState(state);
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

  it("does not start the snippet timer before the requested URI is active and unpaused", async () => {
    const { started } = await begin(100);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(playing.at(-1)).toBe(false);
    expect(progress.at(-1)).toBe(0);

    confirmAt();
    await started;
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS - 1);
    expect(pause).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pause).toHaveBeenCalledTimes(2);
    expect(progress.at(-1)).toBe(100);
    await vi.advanceTimersByTimeAsync(PAUSE_CONFIRM_INTERVAL_MS);
  });

  it.each([[100, 350], [1_000, 1_000], [15_000, 15_000]])(
    "stops a logical %dms snippet at its %dms transport boundary",
    async (logicalDurationMs, transportDurationMs) => {
      const { started } = await begin(logicalDurationMs);
      confirmAt();
      await started;
      await vi.advanceTimersByTimeAsync(transportDurationMs - 1);
      expect(pause).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(pause).toHaveBeenCalledTimes(2);
      expect(progress.at(-1)).toBe(logicalDurationMs);
      await vi.advanceTimersByTimeAsync(PAUSE_CONFIRM_INTERVAL_MS);
    },
  );

  it("cancels an old replay timer so it cannot pause the newer run", async () => {
    const { started: first } = await begin(100);
    confirmAt();
    await first;
    await vi.advanceTimersByTimeAsync(175);

    const second = controller.play(URI, 100, vi.fn(async () => undefined));
    await vi.advanceTimersByTimeAsync(0);
    confirmAt();
    await second;
    await vi.advanceTimersByTimeAsync(175);
    expect(pause).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(175);
    expect(pause).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(PAUSE_CONFIRM_INTERVAL_MS);
  });

  it("ignores a stale paused event when current SDK state still has the requested track playing", async () => {
    const { started } = await begin(100);
    confirmAt();
    await started;
    controller.handleState({ paused: true, position: 0, track_window: { current_track: { uri: URI } } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS);
    expect(pause).toHaveBeenCalledTimes(2);
    expect(progress.at(-1)).toBe(100);
    await vi.advanceTimersByTimeAsync(PAUSE_CONFIRM_INTERVAL_MS);
  });

  it("retries pause while the requested track is still playing and stops after confirmation", async () => {
    pause.mockImplementation(async () => {
      if (pause.mock.calls.length >= 3 && state) state = { ...state, paused: true };
    });
    const { started } = await begin(100);
    confirmAt();
    await started;
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS + (PAUSE_CONFIRM_INTERVAL_MS * 2));
    expect(pause).toHaveBeenCalledTimes(3);
    expect(stopErrors).toEqual([]);
  });

  it("stops pause retries as soon as paused state is confirmed", async () => {
    const { started } = await begin(100);
    confirmAt();
    await started;
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS + 500);
    expect(pause).toHaveBeenCalledTimes(2);
    expect(stopErrors).toEqual([]);
  });

  it("bounds pause retries and reports a genuine stop failure", async () => {
    pause.mockImplementation(async () => undefined);
    const { started } = await begin(100);
    confirmAt();
    await started;
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS + 500);
    expect(pause).toHaveBeenCalledTimes(4);
    expect(stopErrors).toHaveLength(1);
  });

  it("cancels an in-progress stop retry before a newer generation starts", async () => {
    pause.mockImplementation(async () => undefined);
    const { started: first } = await begin(100);
    confirmAt();
    await first;
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS);
    expect(pause).toHaveBeenCalledTimes(2);

    const second = controller.play(URI, 1_000, vi.fn(async () => undefined));
    await vi.advanceTimersByTimeAsync(0);
    confirmAt();
    await second;
    await vi.advanceTimersByTimeAsync(100);
    expect(pause).toHaveBeenCalledTimes(3);
    expect(stopErrors).toEqual([]);
  });

  it("resets fixed-timeline progress when a round action stops playback", async () => {
    const { started } = await begin(1_000);
    confirmAt();
    await started;
    await vi.advanceTimersByTimeAsync(300);
    expect(progress.at(-1)).toBeGreaterThanOrEqual(300);
    const stopping = controller.stop(true);
    await vi.advanceTimersByTimeAsync(PAUSE_CONFIRM_INTERVAL_MS);
    await stopping;
    expect(progress.at(-1)).toBe(0);
  });

  it("requests position zero again on replay", async () => {
    const requests: ReturnType<typeof spotifyPlaybackStartPayload>[] = [];
    const startPlayback = vi.fn(async () => {
      requests.push(spotifyPlaybackStartPayload("device", URI));
    });
    const first = controller.play(URI, 100, startPlayback);
    await vi.advanceTimersByTimeAsync(0);
    confirmAt();
    await first;
    await vi.advanceTimersByTimeAsync(FIRST_SNIPPET_TRANSPORT_MS + PAUSE_CONFIRM_INTERVAL_MS);

    const replay = controller.play(URI, 100, startPlayback);
    await vi.advanceTimersByTimeAsync(0);
    confirmAt();
    await replay;
    expect(requests.map((request) => request.positionMs)).toEqual([0, 0]);
    expect(progress).toContain(0);
  });

  it("fails within a bounded time when Spotify never confirms playback", async () => {
    const { started } = await begin(1_000);
    const rejection = expect(started).rejects.toBeInstanceOf(PlaybackStartTimeoutError);
    await vi.advanceTimersByTimeAsync(PLAYBACK_START_TIMEOUT_MS);
    await rejection;
    expect(pause).toHaveBeenCalledTimes(2);
  });
});
