export const PLAYBACK_START_TIMEOUT_MS = 5_000;
export const PLAYBACK_STATE_POLL_MS = 25;
export const FIRST_SNIPPET_TRANSPORT_MS = 350;
export const PAUSE_CONFIRM_INTERVAL_MS = 40;
export const PAUSE_CONFIRM_MAX_ATTEMPTS = 3;
export const PAUSE_CONFIRM_TIMEOUT_MS = 1_000;

const FIRST_SNIPPET_LOGICAL_MS = 100;

export type SnippetTiming = { logicalDurationMs: number; transportDurationMs: number };

export function snippetTiming(logicalDurationMs: number): SnippetTiming {
  return {
    logicalDurationMs,
    transportDurationMs: logicalDurationMs === FIRST_SNIPPET_LOGICAL_MS
      ? FIRST_SNIPPET_TRANSPORT_MS
      : logicalDurationMs,
  };
}

export function logicalProgressForTransport(elapsedMs: number, timing: SnippetTiming): number {
  const ratio = Math.min(Math.max(elapsedMs, 0) / timing.transportDurationMs, 1);
  return ratio * timing.logicalDurationMs;
}

export function spotifyPlaybackStartPayload(deviceId: string, spotifyUri: string) {
  return { deviceId, spotifyUri, positionMs: 0 } as const;
}

export type SnippetPlayerState = {
  paused: boolean;
  position: number;
  track_window?: { current_track?: { uri?: string } };
};

export type SnippetPlayer = {
  activateElement(): Promise<void>;
  pause(): Promise<void>;
  getCurrentState(): Promise<SnippetPlayerState | null>;
};

type PlaybackCallbacks = {
  onPlaying: (playing: boolean) => void;
  onProgress: (progressMs: number) => void;
  onStopError?: (message: string) => void;
};

type StartWaiter = {
  generation: number;
  spotifyUri: string;
  resolve: (state: SnippetPlayerState) => void;
  reject: (error: Error) => void;
};

export class PlaybackStartTimeoutError extends Error {
  constructor() {
    super("Spotify did not start this track in time. Try again.");
    this.name = "PlaybackStartTimeoutError";
  }
}

export class SnippetPlaybackController {
  private generation = 0;
  private active: { generation: number; spotifyUri: string; timing: SnippetTiming; startedAt: number } | null = null;
  private waiter: StartWaiter | null = null;
  private startPoll: ReturnType<typeof setInterval> | null = null;
  private startTimeout: ReturnType<typeof setTimeout> | null = null;
  private progressPoll: ReturnType<typeof setInterval> | null = null;
  private hardStop: ReturnType<typeof setTimeout> | null = null;
  private pausePromise: Promise<void> | null = null;
  private commandTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly player: SnippetPlayer,
    private readonly callbacks: PlaybackCallbacks,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async play(spotifyUri: string, logicalDurationMs: number, startPlayback: () => Promise<void>): Promise<void> {
    const generation = ++this.generation;
    this.clearRun();
    this.callbacks.onProgress(0);
    this.callbacks.onPlaying(false);

    const command = this.commandTail.then(async () => {
      if (generation !== this.generation) return;
      await this.player.activateElement();
      if (generation !== this.generation) return;
      await this.requestPause();
      if (generation !== this.generation) return;
      await startPlayback();
    });
    this.commandTail = command.catch(() => undefined);
    await command;
    if (generation !== this.generation) return;

    try {
      const state = await this.waitForStart(generation, spotifyUri);
      if (generation !== this.generation) return;
      const timing = snippetTiming(logicalDurationMs);
      this.active = { generation, spotifyUri, timing, startedAt: this.now() };
      this.callbacks.onPlaying(true);
      this.updateProgress(state);
      if (!this.active) return;
      this.progressPoll = setInterval(() => void this.pollActiveState(generation), PLAYBACK_STATE_POLL_MS);
      this.hardStop = setTimeout(() => void this.finish(generation), timing.transportDurationMs);
    } catch (error) {
      if (generation === this.generation) {
        this.clearRun();
        this.callbacks.onPlaying(false);
        await this.requestPause();
      }
      throw error;
    }
  }

  handleState(state: SnippetPlayerState | null): void {
    const waiter = this.waiter;
    if (waiter && this.isRequestedTrackPlaying(state, waiter.spotifyUri)) {
      this.resolveWaiter(state);
      return;
    }
    if (!this.active || !state) return;
    if (state.paused || state.track_window?.current_track?.uri !== this.active.spotifyUri) {
      void this.verifyActiveState(this.active.generation);
      return;
    }
    this.updateProgress(state);
  }

  async stop(resetProgress = false): Promise<void> {
    const spotifyUri = this.active?.spotifyUri ?? this.waiter?.spotifyUri;
    const generation = ++this.generation;
    this.clearRun();
    this.callbacks.onPlaying(false);
    if (resetProgress) this.callbacks.onProgress(0);
    if (spotifyUri) await this.pauseAndConfirm(generation, spotifyUri);
    else await this.requestPause();
  }

  private waitForStart(generation: number, spotifyUri: string): Promise<SnippetPlayerState> {
    return new Promise((resolve, reject) => {
      this.waiter = { generation, spotifyUri, resolve, reject };
      this.startPoll = setInterval(() => void this.pollForStart(generation), PLAYBACK_STATE_POLL_MS);
      this.startTimeout = setTimeout(() => {
        if (this.waiter?.generation !== generation) return;
        this.rejectWaiter(new PlaybackStartTimeoutError());
      }, PLAYBACK_START_TIMEOUT_MS);
      void this.pollForStart(generation);
    });
  }

  private async pollForStart(generation: number): Promise<void> {
    const state = await this.player.getCurrentState().catch(() => null);
    const waiter = this.waiter;
    if (!waiter || waiter.generation !== generation || generation !== this.generation) return;
    if (this.isRequestedTrackPlaying(state, waiter.spotifyUri)) this.resolveWaiter(state);
  }

  private async pollActiveState(generation: number): Promise<void> {
    const state = await this.player.getCurrentState().catch(() => null);
    if (this.active?.generation !== generation || generation !== this.generation) return;
    if (!state) {
      this.updateProgress(null);
      return;
    }
    if (state.paused || state.track_window?.current_track?.uri !== this.active.spotifyUri) {
      this.clearRun();
      this.callbacks.onPlaying(false);
      return;
    }
    this.updateProgress(state);
  }

  private async verifyActiveState(generation: number): Promise<void> {
    const state = await this.player.getCurrentState().catch(() => null);
    if (this.active?.generation !== generation || generation !== this.generation) return;
    if (this.isRequestedTrackPlaying(state, this.active.spotifyUri)) {
      this.updateProgress(state);
      return;
    }
    this.clearRun();
    this.callbacks.onPlaying(false);
  }

  private updateProgress(state: SnippetPlayerState | null): void {
    const active = this.active;
    if (!active) return;
    const sdkPosition = state && !state.paused ? state.position : 0;
    const elapsed = Math.max(sdkPosition, this.now() - active.startedAt);
    this.callbacks.onProgress(logicalProgressForTransport(elapsed, active.timing));
    if (elapsed >= active.timing.transportDurationMs) void this.finish(active.generation);
  }

  private async finish(generation: number): Promise<void> {
    const active = this.active;
    if (!active || active.generation !== generation || generation !== this.generation) return;
    this.callbacks.onProgress(active.timing.logicalDurationMs);
    this.clearRun();
    this.callbacks.onPlaying(false);
    const result = await this.pauseAndConfirm(generation, active.spotifyUri);
    if (result === "failed" && generation === this.generation) {
      this.callbacks.onStopError?.("Spotify did not confirm that playback stopped. Press Pause and try again.");
    }
  }

  private async pauseAndConfirm(
    generation: number,
    spotifyUri: string,
  ): Promise<"confirmed" | "cancelled" | "failed"> {
    const deadline = this.now() + PAUSE_CONFIRM_TIMEOUT_MS;
    for (let attempt = 0; attempt < PAUSE_CONFIRM_MAX_ATTEMPTS; attempt += 1) {
      if (generation !== this.generation) return "cancelled";
      const paused = await this.beforeDeadline(this.requestPause(), deadline);
      if (!paused.completed || generation !== this.generation) return generation === this.generation ? "failed" : "cancelled";
      const waited = await this.beforeDeadline(this.delay(PAUSE_CONFIRM_INTERVAL_MS), deadline);
      if (!waited.completed || generation !== this.generation) return generation === this.generation ? "failed" : "cancelled";
      const result = await this.beforeDeadline(this.player.getCurrentState().catch(() => null), deadline);
      if (!result.completed) return "failed";
      if (generation !== this.generation) return "cancelled";
      if (result.value && !this.isRequestedTrackPlaying(result.value, spotifyUri)) return "confirmed";
    }
    return "failed";
  }

  private async beforeDeadline<T>(
    operation: Promise<T>,
    deadline: number,
  ): Promise<{ completed: true; value: T } | { completed: false }> {
    const remainingMs = deadline - this.now();
    if (remainingMs <= 0) return { completed: false };
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const result = await Promise.race([
      operation.then((value) => ({ completed: true as const, value })),
      new Promise<{ completed: false }>((resolve) => {
        timeout = setTimeout(() => resolve({ completed: false }), remainingMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    return result;
  }

  private delay(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  private isRequestedTrackPlaying(state: SnippetPlayerState | null, spotifyUri: string): state is SnippetPlayerState {
    return Boolean(state && !state.paused && state.track_window?.current_track?.uri === spotifyUri);
  }

  private resolveWaiter(state: SnippetPlayerState): void {
    const waiter = this.waiter;
    if (!waiter) return;
    this.clearStartWait();
    waiter.resolve(state);
  }

  private rejectWaiter(error: Error): void {
    const waiter = this.waiter;
    if (!waiter) return;
    this.clearStartWait();
    waiter.reject(error);
  }

  private clearStartWait(): void {
    if (this.startPoll) clearInterval(this.startPoll);
    if (this.startTimeout) clearTimeout(this.startTimeout);
    this.startPoll = null;
    this.startTimeout = null;
    this.waiter = null;
  }

  private clearRun(): void {
    if (this.waiter) {
      const waiter = this.waiter;
      this.clearStartWait();
      waiter.resolve({ paused: true, position: 0 });
    }
    if (this.progressPoll) clearInterval(this.progressPoll);
    if (this.hardStop) clearTimeout(this.hardStop);
    this.progressPoll = null;
    this.hardStop = null;
    this.active = null;
  }

  private requestPause(): Promise<void> {
    if (this.pausePromise) return this.pausePromise;
    this.pausePromise = this.player.pause().catch(() => undefined).finally(() => {
      this.pausePromise = null;
    });
    return this.pausePromise;
  }
}
