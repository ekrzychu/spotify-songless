export const PLAYBACK_START_TIMEOUT_MS = 5_000;
export const PLAYBACK_STATE_POLL_MS = 25;
export const FIRST_SNIPPET_TRANSPORT_MS = 350;
export const PAUSE_CONFIRM_INTERVAL_MS = 40;
export const PAUSE_CONFIRM_MAX_ATTEMPTS = 3;
export const PAUSE_CONFIRM_TIMEOUT_MS = 1_000;
export const PAUSE_STABILIZATION_MS = 100;
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

export function spotifyPlaybackPausePayload(deviceId: string) {
  return { deviceId } as const;
}

export type PlaybackPhase =
  | "idle"
  | "activating"
  | "remote-loading"
  | "waiting-for-uri"
  | "prime-pausing"
  | "prime-seeking"
  | "armed"
  | "snippet-seeking"
  | "snippet-resuming"
  | "snippet-playing"
  | "snippet-pausing"
  | "failed";

export function isPlaybackBusyPhase(phase: PlaybackPhase): boolean {
  return !["idle", "armed", "snippet-playing", "failed"].includes(phase);
}

export type SnippetPlayerDisallows = {
  pausing?: boolean;
  peeking_next?: boolean;
  peeking_prev?: boolean;
  resuming?: boolean;
  seeking?: boolean;
  skipping_next?: boolean;
  skipping_prev?: boolean;
  toggling_repeat_context?: boolean;
  toggling_repeat_track?: boolean;
  toggling_shuffle?: boolean;
  transferring_playback?: boolean;
};

export type SnippetPlayerState = {
  paused: boolean;
  position: number;
  disallows?: SnippetPlayerDisallows;
  track_window?: { current_track?: { uri?: string } };
};

export type PlaybackDebugSnapshot = {
  phase: PlaybackPhase;
  requestedUri: string | null;
  armedUri: string | null;
  sdkError: string | null;
};

export type PlaybackFailureSnapshot = PlaybackDebugSnapshot & { message: string };

export type SnippetPlayer = {
  activateElement(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  getCurrentState(): Promise<SnippetPlayerState | null>;
};

export type SnippetPlayRequest = {
  spotifyUri: string;
  logicalDurationMs: number;
  primeTrack: (signal: AbortSignal) => Promise<void>;
};

type PlaybackCallbacks = {
  onPlaying: (playing: boolean) => void;
  onProgress: (progressMs: number) => void;
  onPhase?: (phase: PlaybackPhase) => void;
  onStopError?: (message: string) => void;
};

type PlaybackDependencies = {
  pauseRemotely?: () => Promise<void>;
};

type StateWaiter = {
  generation: number;
  predicate: (state: SnippetPlayerState | null) => state is SnippetPlayerState;
  resolve: (state: SnippetPlayerState) => void;
  reject: (error: Error) => void;
};

class PlaybackCancelledError extends Error {}

class PlaybackStopUnconfirmedError extends Error {}

export class PlaybackStartTimeoutError extends Error {
  constructor() {
    super("Spotify did not start this track in time. Try again.");
    this.name = "PlaybackStartTimeoutError";
  }
}

export class SpotifyPlaybackOperationError extends Error {
  constructor(operation: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Spotify ${operation} failed: ${detail}`, { cause });
    this.name = "SpotifyPlaybackOperationError";
  }
}

export class SnippetPlaybackController {
  private generation = 0;
  private phase: PlaybackPhase = "idle";
  private requestedSpotifyUri: string | null = null;
  private armedSpotifyUri: string | null = null;
  private lastSdkError: string | null = null;
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
  private stopPromise: Promise<boolean> | null = null;
  private debugStartedAt = 0;

  constructor(
    private readonly player: SnippetPlayer,
    private readonly callbacks: PlaybackCallbacks,
    private readonly now: () => number = () => performance.now(),
    private readonly dependencies: PlaybackDependencies = {},
  ) {}

  async play(request: SnippetPlayRequest): Promise<void> {
    if (this.preparingTrack || this.active || this.stopPromise) return;
    const generation = ++this.generation;
    this.clearRun();
    this.callbacks.onProgress(0);
    this.callbacks.onPlaying(false);
    this.debugStartedAt = this.now();
    this.requestedSpotifyUri = request.spotifyUri;
    this.lastSdkError = null;
    this.preparingTrack = { generation, spotifyUri: request.spotifyUri };
    this.setPhase("activating", "play requested", request.spotifyUri);

    let initialState: SnippetPlayerState | null = null;
    const command = this.commandTail.then(async () => {
      initialState = await this.prepareLocalSnippet(generation, request);
    });
    this.commandTail = command.catch(() => undefined);
    try {
      await command;
    } catch (error) {
      if (generation !== this.generation || error instanceof PlaybackCancelledError) return;
      if (error instanceof PlaybackStopUnconfirmedError) this.failFromUnconfirmedStop(error);
      else this.failFromOperation(error);
      throw error;
    } finally {
      if (this.preparingTrack?.generation === generation) this.preparingTrack = null;
    }
    if (generation !== this.generation || !initialState) return;

    const timing = snippetTiming(request.logicalDurationMs);
    this.active = { generation, spotifyUri: request.spotifyUri, timing, startedAt: this.now() };
    this.callbacks.onPlaying(true);
    this.setPhase("snippet-playing", "resume confirmed", request.spotifyUri, initialState);
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

  getDebugSnapshot(): PlaybackDebugSnapshot {
    return {
      phase: this.phase,
      requestedUri: this.requestedSpotifyUri,
      armedUri: this.armedSpotifyUri,
      sdkError: this.lastSdkError,
    };
  }

  failFromSdk(message: string): PlaybackFailureSnapshot {
    const failure = { ...this.getDebugSnapshot(), message };
    ++this.generation;
    this.clearRun();
    this.preparingTrack = null;
    this.armedSpotifyUri = null;
    this.lastSdkError = message;
    this.setPhase("failed", "SDK playback failure", this.requestedSpotifyUri ?? "unknown", undefined, message);
    this.callbacks.onPlaying(false);
    return failure;
  }

  invalidateArm(): void {
    this.armedSpotifyUri = null;
    if (this.phase === "armed") this.setPhase("idle", "arm invalidated", this.requestedSpotifyUri ?? "unknown");
  }

  stop(resetProgress = false): Promise<boolean> {
    if (this.stopPromise) return this.stopPromise;
    const operation = this.stopInternal(resetProgress);
    this.stopPromise = operation;
    void operation.finally(() => {
      if (this.stopPromise === operation) this.stopPromise = null;
    });
    return operation;
  }

  private async stopInternal(resetProgress: boolean): Promise<boolean> {
    const spotifyUri = this.active?.spotifyUri
      ?? this.preparingTrack?.spotifyUri
      ?? this.armedSpotifyUri
      ?? this.requestedSpotifyUri;
    const generation = ++this.generation;
    this.clearRun();
    this.preparingTrack = null;
    if (resetProgress) this.callbacks.onProgress(0);
    if (!spotifyUri) {
      this.callbacks.onPlaying(false);
      this.setPhase("idle", "stop completed without an active track", "unknown");
      return true;
    }
    this.setPhase("snippet-pausing", "manual pause requested", spotifyUri);
    try {
      const result = await this.pauseAndConfirm(generation, spotifyUri, "manual pause");
      if (generation !== this.generation) return false;
      if (result === "confirmed") {
        this.callbacks.onPlaying(false);
        this.setPhase(this.armedSpotifyUri === spotifyUri ? "armed" : "idle", "manual pause confirmed", spotifyUri);
        return true;
      }
      if (result === "cancelled") return false;
      this.armedSpotifyUri = null;
      this.callbacks.onPlaying(true);
      this.setPhase("failed", "manual pause was not confirmed", spotifyUri);
      this.callbacks.onStopError?.("Spotify did not confirm that playback stopped. Press Pause and try again.");
      return false;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.armedSpotifyUri = null;
      this.callbacks.onPlaying(true);
      this.setPhase("failed", "manual pause failed", spotifyUri, undefined, this.errorMessage(error));
      this.callbacks.onStopError?.(this.errorMessage(error));
      return false;
    }
  }

  private async prepareLocalSnippet(generation: number, request: SnippetPlayRequest): Promise<SnippetPlayerState> {
    await this.runOperation("activation", () => this.player.activateElement());
    this.ensureGeneration(generation);
    const currentState = await this.player.getCurrentState().catch(() => null);
    this.ensureGeneration(generation);
    const canReuseArm = this.armedSpotifyUri === request.spotifyUri
      && this.isCurrentUri(currentState, request.spotifyUri);

    let preparedState: SnippetPlayerState;
    if (canReuseArm) {
      this.debug("armed URI reused", request.spotifyUri, currentState);
      this.setPhase("snippet-pausing", "replay pause requested", request.spotifyUri, currentState);
      const pauseResult = await this.pauseAndConfirm(generation, request.spotifyUri, "replay pause");
      if (pauseResult === "failed") throw new PlaybackStopUnconfirmedError("Spotify did not confirm that replay playback stopped.");
      this.ensureGeneration(generation);
      this.setPhase("snippet-seeking", "seek 0 requested", request.spotifyUri);
      preparedState = await this.seekAndConfirmZero(generation, request.spotifyUri);
    } else {
      this.armedSpotifyUri = null;
      preparedState = await this.primeTrack(generation, request);
      this.ensureGeneration(generation);
    }

    this.setPhase("snippet-resuming", "resume requested", request.spotifyUri, preparedState);
    this.assertAllowed(preparedState, "resuming", "resume");
    await this.runOperation("resume", () => this.player.resume());
    this.ensureGeneration(generation);
    return this.waitForState(
      generation,
      (state): state is SnippetPlayerState => this.isRequestedTrackPlaying(state, request.spotifyUri),
    );
  }

  private async primeTrack(generation: number, request: SnippetPlayRequest): Promise<SnippetPlayerState> {
    const deadline = this.now() + PLAYBACK_START_TIMEOUT_MS;
    const abort = new AbortController();
    this.primeAbort = abort;

    try {
      this.setPhase("remote-loading", "remote loading", request.spotifyUri);
      const remoteLoad = await this.beforeDeadline(request.primeTrack(abort.signal), deadline);
      if (!remoteLoad.completed) {
        abort.abort();
        throw new PlaybackStartTimeoutError();
      }
      this.ensureGeneration(generation);
      this.setPhase("waiting-for-uri", "waiting for requested URI to play", request.spotifyUri);
      const currentState = await this.waitForState(
        generation,
        (state): state is SnippetPlayerState => this.isRequestedTrackPlaying(state, request.spotifyUri),
        deadline,
      );
      this.debug("requested URI observed playing", request.spotifyUri, currentState);

      this.setPhase("prime-pausing", "prime pause requested", request.spotifyUri, currentState);
      const pauseResult = await this.pauseAndConfirm(generation, request.spotifyUri, "prime pause");
      if (pauseResult === "failed") throw new PlaybackStopUnconfirmedError("Spotify did not confirm that the primed track stopped.");
      this.ensureGeneration(generation);

      this.setPhase("prime-seeking", "seek 0 requested", request.spotifyUri);
      const preparedState = await this.seekAndConfirmZero(generation, request.spotifyUri);
      this.armedSpotifyUri = request.spotifyUri;
      this.setPhase("armed", "armed", request.spotifyUri, preparedState);
      return preparedState;
    } catch (error) {
      this.armedSpotifyUri = null;
      throw error;
    } finally {
      if (this.primeAbort === abort) this.primeAbort = null;
      abort.abort();
    }
  }

  private async seekAndConfirmZero(generation: number, spotifyUri: string): Promise<SnippetPlayerState> {
    const state = await this.player.getCurrentState().catch(() => null);
    this.ensureGeneration(generation);
    this.assertAllowed(state, "seeking", "seek(0)");
    await this.runOperation("seek(0)", () => this.player.seek(0));
    this.ensureGeneration(generation);
    const confirmed = await this.waitForState(
      generation,
      (next): next is SnippetPlayerState => Boolean(
        next && next.paused && this.isCurrentUri(next, spotifyUri) && next.position <= ARMED_POSITION_TOLERANCE_MS,
      ),
    );
    this.debug("seek 0 confirmed", spotifyUri, confirmed);
    return confirmed;
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
      this.setPhase(this.armedSpotifyUri ? "armed" : "idle", "active playback stopped by Spotify", this.requestedSpotifyUri ?? "unknown", state);
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
    this.setPhase(this.armedSpotifyUri ? "armed" : "idle", "active playback state changed", this.requestedSpotifyUri ?? "unknown", state);
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
    this.setPhase("snippet-pausing", "snippet pause requested", active.spotifyUri);
    try {
      const result = await this.pauseAndConfirm(generation, active.spotifyUri, "snippet pause");
      if (generation !== this.generation) return;
      if (result === "confirmed") {
        this.callbacks.onPlaying(false);
        this.setPhase(this.armedSpotifyUri === active.spotifyUri ? "armed" : "idle", "snippet pause confirmed", active.spotifyUri);
        return;
      }
      if (result === "cancelled") return;
      this.armedSpotifyUri = null;
      this.callbacks.onPlaying(true);
      this.setPhase("failed", "snippet pause was not confirmed", active.spotifyUri);
      this.callbacks.onStopError?.("Spotify did not confirm that playback stopped. Press Pause and try again.");
    } catch (error) {
      if (generation !== this.generation) return;
      this.armedSpotifyUri = null;
      this.callbacks.onPlaying(true);
      this.setPhase("failed", "snippet pause failed", active.spotifyUri, undefined, this.errorMessage(error));
      this.callbacks.onStopError?.(this.errorMessage(error));
    }
  }

  private async pauseAndConfirm(
    generation: number,
    spotifyUri: string,
    phaseLabel: string,
  ): Promise<"confirmed" | "cancelled" | "failed"> {
    const deadline = this.now() + PAUSE_CONFIRM_TIMEOUT_MS;
    let state = await this.player.getCurrentState().catch(() => null);
    let localAttempts = 0;
    let remoteAttempted = false;
    if (generation !== this.generation) return "cancelled";

    while (this.now() < deadline) {
      if (generation !== this.generation) return "cancelled";
      if (state && !this.isRequestedTrackPlaying(state, spotifyUri)) {
        const stable = await this.confirmStoppedStaysStable(generation, spotifyUri, deadline);
        if (stable === "cancelled") return "cancelled";
        if (stable === "confirmed") {
          this.debug(`${phaseLabel} confirmed and stable`, spotifyUri, state);
          return "confirmed";
        }
        state = stable;
      }

      if (this.isRequestedTrackPlaying(state, spotifyUri)
        && localAttempts < PAUSE_CONFIRM_MAX_ATTEMPTS
        && !state.disallows?.pausing) {
        localAttempts += 1;
        this.debug(`${phaseLabel} local pause requested`, spotifyUri, state);
        const paused = await this.beforeDeadline(this.requestPause().catch(() => undefined), deadline);
        if (!paused.completed) return "failed";
      } else if (this.isRequestedTrackPlaying(state, spotifyUri)
        && !remoteAttempted
        && this.dependencies.pauseRemotely) {
        remoteAttempted = true;
        this.debug(`${phaseLabel} remote pause requested`, spotifyUri, state);
        const paused = await this.beforeDeadline(this.dependencies.pauseRemotely().catch(() => undefined), deadline);
        if (!paused.completed) return "failed";
      }

      const waited = await this.beforeDeadline(this.delay(PAUSE_CONFIRM_INTERVAL_MS), deadline);
      if (!waited.completed || generation !== this.generation) {
        return generation === this.generation ? "failed" : "cancelled";
      }
      const result = await this.beforeDeadline(this.player.getCurrentState().catch(() => null), deadline);
      if (!result.completed) return "failed";
      state = result.value;
    }
    return "failed";
  }

  private async confirmStoppedStaysStable(
    generation: number,
    spotifyUri: string,
    deadline: number,
  ): Promise<"confirmed" | "cancelled" | SnippetPlayerState | null> {
    const waited = await this.beforeDeadline(this.delay(PAUSE_STABILIZATION_MS), deadline);
    if (!waited.completed) return null;
    if (generation !== this.generation) return "cancelled";
    const result = await this.beforeDeadline(this.player.getCurrentState().catch(() => null), deadline);
    if (!result.completed) return null;
    if (generation !== this.generation) return "cancelled";
    return result.value && !this.isRequestedTrackPlaying(result.value, spotifyUri)
      ? "confirmed"
      : result.value;
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

  private assertAllowed(
    state: SnippetPlayerState | null,
    restriction: "pausing" | "seeking" | "resuming",
    operation: string,
  ): void {
    if (state?.disallows?.[restriction]) {
      throw new Error(`Spotify currently disallows ${operation} while playback is in phase ${this.phase}.`);
    }
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
    if (this.waiter) this.rejectWaiter(new PlaybackCancelledError());
    if (this.progressPoll) clearInterval(this.progressPoll);
    if (this.hardStop) clearTimeout(this.hardStop);
    this.progressPoll = null;
    this.hardStop = null;
    this.active = null;
  }

  private requestPause(): Promise<void> {
    if (this.pausePromise) return this.pausePromise;
    this.pausePromise = this.player.pause().finally(() => {
      this.pausePromise = null;
    });
    return this.pausePromise;
  }

  private async runOperation<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw new SpotifyPlaybackOperationError(operation, error);
    }
  }

  private failFromOperation(error: unknown): void {
    ++this.generation;
    this.clearRun();
    this.preparingTrack = null;
    this.armedSpotifyUri = null;
    this.setPhase("failed", "operation failed", this.requestedSpotifyUri ?? "unknown", undefined, this.errorMessage(error));
    this.callbacks.onPlaying(false);
  }

  private failFromUnconfirmedStop(error: PlaybackStopUnconfirmedError): void {
    ++this.generation;
    this.clearRun();
    this.preparingTrack = null;
    this.armedSpotifyUri = null;
    this.callbacks.onPlaying(true);
    this.setPhase("failed", "stop could not be confirmed", this.requestedSpotifyUri ?? "unknown", undefined, error.message);
    this.callbacks.onStopError?.(`${error.message} Press Pause and try again.`);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private setPhase(
    phase: PlaybackPhase,
    event: string,
    spotifyUri: string,
    state?: SnippetPlayerState | null,
    error?: string,
  ): void {
    this.phase = phase;
    this.callbacks.onPhase?.(phase);
    this.debug(event, spotifyUri, state, error);
  }

  private debug(event: string, spotifyUri: string, state?: SnippetPlayerState | null, error?: string): void {
    if (!PLAYBACK_DEBUG) return;
    console.debug("[spodle playback]", {
      event,
      phase: this.phase,
      requestedUri: this.requestedSpotifyUri,
      armedUri: this.armedSpotifyUri,
      spotifyUri,
      currentUri: state?.track_window?.current_track?.uri,
      paused: state?.paused,
      position: state?.position,
      disallows: state?.disallows,
      error,
      elapsedMs: Math.round(this.now() - this.debugStartedAt),
    });
  }
}
