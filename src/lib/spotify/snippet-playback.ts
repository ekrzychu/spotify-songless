export const PLAYBACK_START_TIMEOUT_MS = 5_000;
export const PLAYBACK_STATE_POLL_MS = 25;
export const FIRST_SNIPPET_TRANSPORT_MS = 350;
export const PAUSE_CONFIRM_INTERVAL_MS = 40;
export const PAUSE_CONFIRM_MAX_ATTEMPTS = 3;
export const PAUSE_CONFIRM_TIMEOUT_MS = 1_000;
export const ARMED_POSITION_TOLERANCE_MS = 100;

const FIRST_SNIPPET_LOGICAL_MS = 100;
const PLAYBACK_DEBUG = process.env.NODE_ENV === "development"
  && process.env.NEXT_PUBLIC_SPOTIFY_PLAYBACK_DEBUG === "true";

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
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  getCurrentState(): Promise<SnippetPlayerState | null>;
  getVolume(): Promise<number>;
  setVolume(volume: number): Promise<void>;
};

export type SnippetPlayRequest = {
  spotifyUri: string;
  logicalDurationMs: number;
  primeTrack: (signal: AbortSignal) => Promise<void>;
};

type PlaybackCallbacks = {
  onPlaying: (playing: boolean) => void;
  onProgress: (progressMs: number) => void;
  onStopError?: (message: string) => void;
};

type StateWaiter = {
  generation: number;
  predicate: (state: SnippetPlayerState | null) => state is SnippetPlayerState;
  resolve: (state: SnippetPlayerState) => void;
  reject: (error: Error) => void;
};

class PlaybackCancelledError extends Error {}

export class PlaybackStartTimeoutError extends Error {
  constructor() {
    super("Spotify did not start this track in time. Try again.");
    this.name = "PlaybackStartTimeoutError";
  }
}

export class SnippetPlaybackController {
  private generation = 0;
  private armedSpotifyUri: string | null = null;
  private active: { generation: number; spotifyUri: string; timing: SnippetTiming; startedAt: number } | null = null;
  private waiter: StateWaiter | null = null;
  private statePoll: ReturnType<typeof setInterval> | null = null;
  private stateTimeout: ReturnType<typeof setTimeout> | null = null;
  private progressPoll: ReturnType<typeof setInterval> | null = null;
  private hardStop: ReturnType<typeof setTimeout> | null = null;
  private pausePromise: Promise<void> | null = null;
  private commandTail: Promise<void> = Promise.resolve();
  private primeAbort: AbortController | null = null;
  private preparingTrack: { generation: number; spotifyUri: string } | null = null;
  private debugStartedAt = 0;

  constructor(
    private readonly player: SnippetPlayer,
    private readonly callbacks: PlaybackCallbacks,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async play(request: SnippetPlayRequest): Promise<void> {
    const generation = ++this.generation;
    this.clearRun();
    this.callbacks.onProgress(0);
    this.callbacks.onPlaying(false);
    this.debugStartedAt = this.now();
    this.preparingTrack = { generation, spotifyUri: request.spotifyUri };
    this.debug("play requested", request.spotifyUri);

    let initialState: SnippetPlayerState | null = null;
    const command = this.commandTail.then(async () => {
      initialState = await this.prepareLocalSnippet(generation, request);
    });
    this.commandTail = command.catch(() => undefined);
    try {
      await command;
    } catch (error) {
      if (generation !== this.generation || error instanceof PlaybackCancelledError) return;
      throw error;
    } finally {
      if (this.preparingTrack?.generation === generation) this.preparingTrack = null;
    }
    if (generation !== this.generation || !initialState) return;

    const timing = snippetTiming(request.logicalDurationMs);
    this.active = { generation, spotifyUri: request.spotifyUri, timing, startedAt: this.now() };
    this.callbacks.onPlaying(true);
    this.debug("local playback confirmed", request.spotifyUri, initialState);
    this.updateProgress(initialState);
    if (!this.active) return;
    this.progressPoll = setInterval(() => void this.pollActiveState(generation), PLAYBACK_STATE_POLL_MS);
    this.hardStop = setTimeout(() => void this.finish(generation), timing.transportDurationMs);
  }

  handleState(state: SnippetPlayerState | null): void {
    const waiter = this.waiter;
    if (waiter && waiter.predicate(state)) {
      this.resolveWaiter(state);
      return;
    }
    if (!this.active || !state) return;
    if (state.paused || !this.isCurrentUri(state, this.active.spotifyUri)) {
      void this.verifyActiveState(this.active.generation);
      return;
    }
    this.updateProgress(state);
  }

  invalidateArm(): void {
    this.armedSpotifyUri = null;
  }

  async stop(resetProgress = false): Promise<void> {
    const spotifyUri = this.active?.spotifyUri ?? this.preparingTrack?.spotifyUri ?? this.armedSpotifyUri;
    const generation = ++this.generation;
    this.clearRun();
    this.preparingTrack = null;
    this.callbacks.onPlaying(false);
    if (resetProgress) this.callbacks.onProgress(0);
    if (spotifyUri) await this.pauseAndConfirm(generation, spotifyUri, "manual pause");
    else await this.requestPause();
  }

  private async prepareLocalSnippet(
    generation: number,
    request: SnippetPlayRequest,
  ): Promise<SnippetPlayerState> {
    await this.player.activateElement();
    this.ensureGeneration(generation);
    const currentState = await this.player.getCurrentState().catch(() => null);
    this.ensureGeneration(generation);
    const canReuseArm = this.armedSpotifyUri === request.spotifyUri
      && this.isCurrentUri(currentState, request.spotifyUri);

    if (canReuseArm) {
      this.debug("armed URI reused", request.spotifyUri, currentState);
      const pauseResult = await this.pauseAndConfirm(generation, request.spotifyUri, "replay pause");
      if (pauseResult === "failed") throw new Error("Spotify did not confirm that playback stopped.");
      this.ensureGeneration(generation);
    } else {
      this.armedSpotifyUri = null;
      await this.primeTrack(generation, request);
      this.ensureGeneration(generation);
    }

    await this.seekAndConfirmZero(generation, request.spotifyUri);
    this.debug("local resume requested", request.spotifyUri);
    await this.player.resume();
    this.ensureGeneration(generation);
    return this.waitForState(
      generation,
      (state): state is SnippetPlayerState => this.isRequestedTrackPlaying(state, request.spotifyUri),
    );
  }

  private async primeTrack(generation: number, request: SnippetPlayRequest): Promise<void> {
    const deadline = this.now() + PLAYBACK_START_TIMEOUT_MS;
    let originalVolume: number | null = null;
    let muted = false;
    const abort = new AbortController();
    this.primeAbort = abort;

    try {
      originalVolume = await this.player.getVolume().catch(() => null);
      this.ensureGeneration(generation);
      if (originalVolume !== null) {
        await this.player.setVolume(0);
        muted = true;
      }
      this.ensureGeneration(generation);
      await this.requestPause();
      this.ensureGeneration(generation);
      this.debug("remote prime start", request.spotifyUri);
      const remoteLoad = await this.beforeDeadline(request.primeTrack(abort.signal), deadline);
      if (!remoteLoad.completed) {
        abort.abort();
        throw new PlaybackStartTimeoutError();
      }
      this.ensureGeneration(generation);
      const currentState = await this.waitForState(
        generation,
        (state): state is SnippetPlayerState => this.isCurrentUri(state, request.spotifyUri),
        deadline,
      );
      this.debug("requested URI became current", request.spotifyUri, currentState);
      const pauseResult = await this.pauseAndConfirm(generation, request.spotifyUri, "prime pause");
      if (pauseResult === "failed") throw new Error("Spotify did not confirm that the primed track stopped.");
      this.ensureGeneration(generation);
      await this.seekAndConfirmZero(generation, request.spotifyUri);
      this.armedSpotifyUri = request.spotifyUri;
      this.debug("armed", request.spotifyUri, await this.player.getCurrentState().catch(() => null));
    } catch (error) {
      this.armedSpotifyUri = null;
      const state = await this.player.getCurrentState().catch(() => null);
      if (generation === this.generation && this.isCurrentUri(state, request.spotifyUri)) {
        await this.pauseAndConfirm(generation, request.spotifyUri, "prime failure pause");
      }
      throw error;
    } finally {
      if (this.primeAbort === abort) this.primeAbort = null;
      abort.abort();
      if (muted && originalVolume !== null) {
        try {
          await this.player.setVolume(originalVolume);
        } catch {
          await this.player.setVolume(originalVolume);
        }
      }
    }
  }

  private async seekAndConfirmZero(generation: number, spotifyUri: string): Promise<SnippetPlayerState> {
    this.debug("seek zero requested", spotifyUri);
    await this.player.seek(0);
    this.ensureGeneration(generation);
    return this.waitForState(
      generation,
      (state): state is SnippetPlayerState => Boolean(
        state
        && state.paused
        && this.isCurrentUri(state, spotifyUri)
        && state.position <= ARMED_POSITION_TOLERANCE_MS,
      ),
    );
  }

  private waitForState(
    generation: number,
    predicate: StateWaiter["predicate"],
    deadline = this.now() + PLAYBACK_START_TIMEOUT_MS,
  ): Promise<SnippetPlayerState> {
    return new Promise((resolve, reject) => {
      const remainingMs = deadline - this.now();
      if (remainingMs <= 0) {
        reject(new PlaybackStartTimeoutError());
        return;
      }
      this.waiter = { generation, predicate, resolve, reject };
      this.statePoll = setInterval(() => void this.pollForState(generation), PLAYBACK_STATE_POLL_MS);
      this.stateTimeout = setTimeout(() => {
        if (this.waiter?.generation !== generation) return;
        this.rejectWaiter(new PlaybackStartTimeoutError());
      }, remainingMs);
      void this.pollForState(generation);
    });
  }

  private async pollForState(generation: number): Promise<void> {
    const state = await this.player.getCurrentState().catch(() => null);
    const waiter = this.waiter;
    if (!waiter || waiter.generation !== generation || generation !== this.generation) return;
    if (waiter.predicate(state)) this.resolveWaiter(state);
  }

  private async pollActiveState(generation: number): Promise<void> {
    const state = await this.player.getCurrentState().catch(() => null);
    if (this.active?.generation !== generation || generation !== this.generation) return;
    if (!state) {
      this.updateProgress(null);
      return;
    }
    if (state.paused || !this.isCurrentUri(state, this.active.spotifyUri)) {
      if (!this.isCurrentUri(state, this.active.spotifyUri)) this.armedSpotifyUri = null;
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
    if (state && !this.isCurrentUri(state, this.active.spotifyUri)) this.armedSpotifyUri = null;
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
    this.debug("snippet deadline", active.spotifyUri);
    this.callbacks.onProgress(active.timing.logicalDurationMs);
    this.clearRun();
    this.callbacks.onPlaying(false);
    const result = await this.pauseAndConfirm(generation, active.spotifyUri, "snippet pause");
    if (result === "failed" && generation === this.generation) {
      this.armedSpotifyUri = null;
      this.callbacks.onStopError?.("Spotify did not confirm that playback stopped. Press Pause and try again.");
    }
  }

  private async pauseAndConfirm(
    generation: number,
    spotifyUri: string,
    phase: string,
  ): Promise<"confirmed" | "cancelled" | "failed"> {
    const deadline = this.now() + PAUSE_CONFIRM_TIMEOUT_MS;
    for (let attempt = 0; attempt < PAUSE_CONFIRM_MAX_ATTEMPTS; attempt += 1) {
      if (generation !== this.generation) return "cancelled";
      this.debug(`${phase} requested`, spotifyUri);
      const paused = await this.beforeDeadline(this.requestPause(), deadline);
      if (!paused.completed || generation !== this.generation) return generation === this.generation ? "failed" : "cancelled";
      const waited = await this.beforeDeadline(this.delay(PAUSE_CONFIRM_INTERVAL_MS), deadline);
      if (!waited.completed || generation !== this.generation) return generation === this.generation ? "failed" : "cancelled";
      const result = await this.beforeDeadline(this.player.getCurrentState().catch(() => null), deadline);
      if (!result.completed) return "failed";
      if (generation !== this.generation) return "cancelled";
      if (result.value && !this.isRequestedTrackPlaying(result.value, spotifyUri)) {
        this.debug(`${phase} confirmed`, spotifyUri, result.value);
        return "confirmed";
      }
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

  private isCurrentUri(state: SnippetPlayerState | null, spotifyUri: string): state is SnippetPlayerState {
    return Boolean(state && state.track_window?.current_track?.uri === spotifyUri);
  }

  private isRequestedTrackPlaying(state: SnippetPlayerState | null, spotifyUri: string): state is SnippetPlayerState {
    return Boolean(state && !state.paused && this.isCurrentUri(state, spotifyUri));
  }

  private ensureGeneration(generation: number): void {
    if (generation !== this.generation) throw new PlaybackCancelledError();
  }

  private resolveWaiter(state: SnippetPlayerState): void {
    const waiter = this.waiter;
    if (!waiter) return;
    this.clearStateWait();
    waiter.resolve(state);
  }

  private rejectWaiter(error: Error): void {
    const waiter = this.waiter;
    if (!waiter) return;
    this.clearStateWait();
    waiter.reject(error);
  }

  private clearStateWait(): void {
    if (this.statePoll) clearInterval(this.statePoll);
    if (this.stateTimeout) clearTimeout(this.stateTimeout);
    this.statePoll = null;
    this.stateTimeout = null;
    this.waiter = null;
  }

  private clearRun(): void {
    this.primeAbort?.abort();
    this.primeAbort = null;
    if (this.waiter) {
      const waiter = this.waiter;
      this.clearStateWait();
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

  private debug(event: string, spotifyUri: string, state?: SnippetPlayerState | null): void {
    if (!PLAYBACK_DEBUG) return;
    console.debug("[spodle playback]", {
      event,
      spotifyUri,
      paused: state?.paused,
      positionMs: state?.position,
      elapsedMs: Math.round(this.now() - this.debugStartedAt),
    });
  }
}
