import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLAYBACK_START_TIMEOUT_MS,
  PlaybackStartTimeoutError,
  SnippetPlaybackController,
  type SnippetPlayerState,
} from "@/lib/spotify/snippet-playback";

const URI = "spotify:track:0123456789012345678901";

describe("snippet playback synchronization", () => {
  let state: SnippetPlayerState | null;
  let pause: ReturnType<typeof vi.fn>;
  let controller: SnippetPlaybackController;
  let playing: boolean[];
  let progress: number[];

  beforeEach(() => {
    vi.useFakeTimers();
    state = { paused: true, position: 0, track_window: { current_track: { uri: URI } } };
    pause = vi.fn(async () => { if (state) state = { ...state, paused: true }; });
    playing = [];
    progress = [];
    controller = new SnippetPlaybackController({
      activateElement: vi.fn(async () => undefined),
      pause,
      getCurrentState: vi.fn(async () => state),
    }, {
      onPlaying: (value) => playing.push(value),
      onProgress: (value) => progress.push(value),
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

  it("does not start the snippet timer before the requested URI is active and unpaused", async () => {
    const { started } = await begin(100);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(playing.at(-1)).toBe(false);
    expect(progress.at(-1)).toBe(0);

    confirmAt();
    await started;
    await vi.advanceTimersByTimeAsync(99);
    expect(pause).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pause).toHaveBeenCalledTimes(2);
    expect(progress.at(-1)).toBe(100);
  });

  it.each([100, 1_000, 15_000])("stops a %dms snippet at its exact post-confirmation boundary", async (durationMs) => {
    const { started } = await begin(durationMs);
    confirmAt();
    await started;
    await vi.advanceTimersByTimeAsync(durationMs - 1);
    expect(pause).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pause).toHaveBeenCalledTimes(2);
    expect(progress.at(-1)).toBe(durationMs);
  });

  it("cancels an old replay timer so it cannot pause the newer run", async () => {
    const { started: first } = await begin(100);
    confirmAt();
    await first;
    await vi.advanceTimersByTimeAsync(50);

    const second = controller.play(URI, 100, vi.fn(async () => undefined));
    await vi.advanceTimersByTimeAsync(0);
    confirmAt();
    await second;
    await vi.advanceTimersByTimeAsync(50);
    expect(pause).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(pause).toHaveBeenCalledTimes(3);
  });

  it("ignores a stale paused event when current SDK state still has the requested track playing", async () => {
    const { started } = await begin(100);
    confirmAt();
    await started;
    controller.handleState({ paused: true, position: 0, track_window: { current_track: { uri: URI } } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(pause).toHaveBeenCalledTimes(2);
    expect(progress.at(-1)).toBe(100);
  });

  it("resets fixed-timeline progress when a round action stops playback", async () => {
    const { started } = await begin(1_000);
    confirmAt();
    await started;
    await vi.advanceTimersByTimeAsync(300);
    expect(progress.at(-1)).toBeGreaterThanOrEqual(300);
    await controller.stop(true);
    expect(progress.at(-1)).toBe(0);
  });

  it("fails within a bounded time when Spotify never confirms playback", async () => {
    const { started } = await begin(1_000);
    const rejection = expect(started).rejects.toBeInstanceOf(PlaybackStartTimeoutError);
    await vi.advanceTimersByTimeAsync(PLAYBACK_START_TIMEOUT_MS);
    await rejection;
    expect(pause).toHaveBeenCalledTimes(2);
  });
});
