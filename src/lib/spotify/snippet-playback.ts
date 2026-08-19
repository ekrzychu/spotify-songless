export const PLAYBACK_START_TIMEOUT_MS = 5_000;
export const PLAYBACK_STATE_POLL_MS = 40;
export const STABLE_START_WINDOW_MS = 500;
export const STABLE_START_MIN_ADVANCE_MS = 120;
export const STABLE_START_BACKWARD_TOLERANCE_MS = 80;
export const PAUSE_CONFIRM_INTERVAL_MS = 40;
export const PAUSE_CONFIRM_MAX_ATTEMPTS = 3;
export const PAUSE_CONFIRM_TIMEOUT_MS = 1_000;
export const PAUSE_STABILIZATION_MS = 100;
export const ARMED_POSITION_TOLERANCE_MS = 100;

const PLAYBACK_DEBUG = process.env.NODE_ENV === "development"
  && process.env.NEXT_PUBLIC_SPOTIFY_PLAYBACK_DEBUG === "true";

export type SnippetTiming = { logicalDurationMs: number; transportDurationMs: number };

export function snippetTiming(logicalDurationMs: number): SnippetTiming {
  return { logicalDurationMs, transportDurationMs: logicalDurationMs };
}

export function logicalProgressForTransport(elapsedMs: number, timing: SnippetTiming): number {
  return Math.min(Math.max(elapsedMs, 0), timing.logicalDurationMs);
}

export function spotifyPlaybackStartPayload(deviceId: string, spotifyUri: string) {
  return { deviceId, spotifyUri, positionMs: 0 } as const;
}

export type PlaybackPhase =
  | "idle"
  | "prime-muting"
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

export type SnippetPlayerDisallows = { pausing?: boolean; resuming?: boolean; seeking?: boolean };

export type SnippetTrackMetadata = {
  id?: string;
  uri?: string;
  name?: string;
  album?: {
    name?: string;
    images?: Array<{ url: string; width?: number | null; height?: number | null }>;
  };
  artists?: Array<{ name: string }>;
};

export type SnippetPlayerState = {
  paused: boolean;
  position: number;
  disallows?: SnippetPlayerDisallows;
  track_window?: { current_track?: SnippetTrackMetadata };
};

export type PlaybackDebugSnapshot = {
  phase: PlaybackPhase;
  requestedUri: string | null;
  armedUri: string | null;
  transportMuted: boolean;
  transportFaulted: boolean;
  sdkError: string | null;
};

export type PlaybackFailureSnapshot = PlaybackDebugSnapshot & { message: string };

export type SnippetPlayer = {
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
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
  onState?: (state: SnippetPlayerState | null) => void;
  onStopError?: (message: string) => void;
};

type StateWaiter = {
  generation: number;
  predicate: (state: SnippetPlayerState | null) => state is SnippetPlayerState;
  resolve: (state: SnippetPlayerState) => void;
  reject: (error: Error) => void;
};

type ActiveSnippet = {
  generation: number;
  spotifyUri: string;
  logicalDurationMs: number;
  startedAt: number;
  lastPositionMs: number;
};

class PlaybackCancelledError extends Error {}
class PlaybackStopUnconfirmedError extends Error {}

export class PlaybackStartTimeoutError extends Error {
  constructor() {
    super("Spotify did not stabilize this track in time. Try again.");
    this.name = "PlaybackStartTimeoutError";
  }
}

export class PlaybackTransportFaultError extends Error {
  constructor() {
    super("Spotify transport is muted because stopping could not be confirmed. Press Pause to repair it.");
    this.name = "PlaybackTransportFaultError";
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
  private active: ActiveSnippet | null = null;
  private waiter: StateWaiter | null = null;
  private statePoll: ReturnType<typeof setInterval> | null = null;
  private stateTimeout: ReturnType<typeof setTimeout> | null = null;
  private progressPoll: ReturnType<typeof setInterval> | null = null;
  private hardStop: ReturnType<typeof setTimeout> | null = null;
  private commandTail: Promise<void> = Promise.resolve();
  private primeAbort: AbortController | null = null;
  private preparingTrack: { generation: number; spotifyUri: string } | null = null;
  private stopPromise: Promise<boolean> | null = null;
  private userVolume = 0.65;
  private transportMuted = false;
  private transportFaulted = false;
  private debugStartedAt = 0;

  constructor(
    private readonly player: SnippetPlayer,
    private readonly callbacks: PlaybackCallbacks,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async setUserVolume(volume: number): Promise<void> {
    this.userVolume = Math.min(Math.max(volume, 0), 1);
    if (!this.transportMuted) await this.runOperation("volume update", () => this.player.setVolume(this.userVolume));
  }

  isAudiblyPlaying(): boolean {
    return Boolean(this.active && this.phase === "snippet-playing" && !this.transportMuted);
  }

  extendActiveSnippet(logicalDurationMs: number): boolean {
    const active = this.active;
    if (!active || this.phase !== "snippet-playing" || this.transportMuted || logicalDurationMs <= active.logicalDurationMs) return false;
    active.logicalDurationMs = logicalDurationMs;
    this.scheduleCutoff(active);
    this.debug("snippet endpoint extended", active.spotifyUri, undefined, `${logicalDurationMs}ms`);
    return true;
  }

  async play(request: SnippetPlayRequest): Promise<void> {
    if (this.transportFaulted) throw new PlaybackTransportFaultError();
    if (this.preparingTrack || this.active || this.stopPromise) return;
    const generation = ++this.generation;
    this.clearRun();
    this.callbacks.onProgress(0);
    this.callbacks.onPlaying(false);
    this.debugStartedAt = this.now();
    this.requestedSpotifyUri = request.spotifyUri;
    this.lastSdkError = null;
    this.preparingTrack = { generation, spotifyUri: request.spotifyUri };

    const command = this.commandTail.then(() => this.prepareLocalSnippet(generation, request));
    this.commandTail = command.then(() => undefined, () => undefined);
    let initialState: SnippetPlayerState;
    try {
      initialState = await command;
    } catch (error) {
      if (generation !== this.generation || error instanceof PlaybackCancelledError) return;
      if (error instanceof PlaybackStopUnconfirmedError) this.failFromUnconfirmedStop(error);
      else await this.failFromOperation(error);
      throw error;
    } finally {
      if (this.preparingTrack?.generation === generation) this.preparingTrack = null;
    }
    if (generation !== this.generation) return;

    this.active = {
      generation, spotifyUri: request.spotifyUri, logicalDurationMs: request.logicalDurationMs,
      startedAt: this.now(), lastPositionMs: initialState.position,
    };
    this.callbacks.onPlaying(true);
    this.setPhase("snippet-playing", "resume confirmed", request.spotifyUri, initialState);
    this.updateProgress(initialState);
    if (!this.active) return;
    this.progressPoll = setInterval(() => void this.pollActiveState(generation), PLAYBACK_STATE_POLL_MS);
    this.scheduleCutoff(this.active);
  }

  handleState(state: SnippetPlayerState | null): void {
    this.callbacks.onState?.(state);
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
      phase: this.phase, requestedUri: this.requestedSpotifyUri, armedUri: this.armedSpotifyUri,
      transportMuted: this.transportMuted, transportFaulted: this.transportFaulted, sdkError: this.lastSdkError,
    };
  }

  failFromSdk(message: string): PlaybackFailureSnapshot {
    const failure = { ...this.getDebugSnapshot(), message };
    ++this.generation;
    this.clearRun();
    this.preparingTrack = null;
    this.armedSpotifyUri = null;
    this.lastSdkError = message;
    this.transportFaulted = true;
    this.transportMuted = true;
    void this.player.setVolume(0).catch(() => undefined);
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
    void operation.finally(() => { if (this.stopPromise === operation) this.stopPromise = null; });
    return operation;
  }

  private async stopInternal(resetProgress: boolean): Promise<boolean> {
    const spotifyUri = this.active?.spotifyUri ?? this.preparingTrack?.spotifyUri ?? this.armedSpotifyUri ?? this.requestedSpotifyUri;
    const generation = ++this.generation;
    this.clearRun();
    this.preparingTrack = null;
    if (resetProgress) this.callbacks.onProgress(0);
    if (!spotifyUri) {
      await this.restoreUserVolume();
      this.transportFaulted = false;
      this.callbacks.onPlaying(false);
      this.setPhase("idle", "stop completed without an active track", "unknown");
      return true;
    }

    this.setPhase("snippet-pausing", "manual pause requested", spotifyUri);
    await this.muteTransport();
    this.callbacks.onPlaying(false);
    try {
      const result = await this.pauseAndConfirm(generation, spotifyUri, "manual pause");
      if (generation !== this.generation || result === "cancelled") return false;
      if (result === "confirmed") {
        this.transportFaulted = false;
        await this.restoreUserVolume();
        this.setPhase(this.armedSpotifyUri === spotifyUri ? "armed" : "idle", "manual pause confirmed", spotifyUri);
        return true;
      }
      this.failSilent("Spotify did not confirm that playback stopped. Audio remains muted; press Pause to retry.", spotifyUri);
      return false;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.failSilent(this.errorMessage(error), spotifyUri);
      return false;
    }
  }

  private async prepareLocalSnippet(generation: number, request: SnippetPlayRequest): Promise<SnippetPlayerState> {
    this.setPhase("prime-muting", "muting before preparation", request.spotifyUri);
    await this.muteTransport();
    this.ensureGeneration(generation);
    const currentState = await this.readState();
    this.ensureGeneration(generation);
    const canReuseArm = this.armedSpotifyUri === request.spotifyUri && Boolean(currentState?.paused)
      && this.isCurrentUri(currentState, request.spotifyUri);

    let preparedState: SnippetPlayerState;
    if (canReuseArm) {
      this.setPhase("snippet-seeking", "replay seek 0 requested", request.spotifyUri, currentState);
      preparedState = await this.seekAndConfirmZero(generation, request.spotifyUri);
    } else {
      this.armedSpotifyUri = null;
      preparedState = await this.primeTrack(generation, request);
      this.ensureGeneration(generation);
    }

    await this.restoreUserVolume();
    this.ensureGeneration(generation);
    this.setPhase("snippet-resuming", "resume requested", request.spotifyUri, preparedState);
    this.assertAllowed(preparedState, "resuming", "resume");
    await this.runOperation("resume", () => this.player.resume());
    this.ensureGeneration(generation);
    return this.waitForState(generation, (state): state is SnippetPlayerState => this.isRequestedTrackPlaying(state, request.spotifyUri));
  }

  private async primeTrack(generation: number, request: SnippetPlayRequest): Promise<SnippetPlayerState> {
    const deadline = this.now() + PLAYBACK_START_TIMEOUT_MS;
    const abort = new AbortController();
    this.primeAbort = abort;
    try {
      this.setPhase("remote-loading", "remote loading while muted", request.spotifyUri);
      const remoteLoad = await this.beforeDeadline(request.primeTrack(abort.signal), deadline);
      if (!remoteLoad.completed) throw new PlaybackStartTimeoutError();
      this.ensureGeneration(generation);
      this.setPhase("waiting-for-uri", "waiting for stable requested URI", request.spotifyUri);
      const currentState = await this.waitForStableStart(generation, request.spotifyUri, deadline);

      this.setPhase("prime-pausing", "silent prime pause requested", request.spotifyUri, currentState);
      const pauseResult = await this.pauseAndConfirm(generation, request.spotifyUri, "prime pause");
      if (pauseResult === "failed") throw new PlaybackStopUnconfirmedError("Spotify did not confirm that the silent warm-up stopped.");
      this.ensureGeneration(generation);

      this.setPhase("prime-seeking", "seek 0 requested", request.spotifyUri);
      const preparedState = await this.seekAndConfirmZero(generation, request.spotifyUri);
      this.armedSpotifyUri = request.spotifyUri;
      this.setPhase("armed", "armed", request.spotifyUri, preparedState);
      return preparedState;
    } finally {
      if (this.primeAbort === abort) this.primeAbort = null;
      abort.abort();
    }
  }

  private async waitForStableStart(generation: number, spotifyUri: string, deadline: number): Promise<SnippetPlayerState> {
    let stableSince: number | null = null;
    let stableStartPosition = 0;
    let lastPosition: number | null = null;
    while (this.now() < deadline) {
      this.ensureGeneration(generation);
      const state = await this.readState();
      this.ensureGeneration(generation);
      if (this.isRequestedTrackPlaying(state, spotifyUri)) {
        const reset = lastPosition !== null && state.position < lastPosition - STABLE_START_BACKWARD_TOLERANCE_MS;
        if (stableSince === null || reset) {
          stableSince = this.now();
          stableStartPosition = state.position;
        }
        lastPosition = state.position;
        if (this.now() - stableSince >= STABLE_START_WINDOW_MS
          && state.position - stableStartPosition >= STABLE_START_MIN_ADVANCE_MS) return state;
      } else {
        stableSince = null;
        lastPosition = null;
      }
      await this.delay(PLAYBACK_STATE_POLL_MS, generation);
    }
    throw new PlaybackStartTimeoutError();
  }

  private async seekAndConfirmZero(generation: number, spotifyUri: string): Promise<SnippetPlayerState> {
    const state = await this.readState();
    this.ensureGeneration(generation);
    this.assertAllowed(state, "seeking", "seek(0)");
    await this.runOperation("seek(0)", () => this.player.seek(0));
    this.ensureGeneration(generation);
    return this.waitForState(generation, (next): next is SnippetPlayerState => Boolean(
      next && next.paused && this.isCurrentUri(next, spotifyUri) && next.position <= ARMED_POSITION_TOLERANCE_MS,
    ));
  }

  private waitForState(generation: number, predicate: StateWaiter["predicate"], deadline = this.now() + PLAYBACK_START_TIMEOUT_MS): Promise<SnippetPlayerState> {
    return new Promise((resolve, reject) => {
      const remainingMs = deadline - this.now();
      if (remainingMs <= 0) return reject(new PlaybackStartTimeoutError());
      this.waiter = { generation, predicate, resolve, reject };
      this.statePoll = setInterval(() => void this.pollForState(generation), PLAYBACK_STATE_POLL_MS);
      this.stateTimeout = setTimeout(() => {
        if (this.waiter?.generation === generation) this.rejectWaiter(new PlaybackStartTimeoutError());
      }, remainingMs);
      void this.pollForState(generation);
    });
  }

  private async pollForState(generation: number): Promise<void> {
    const state = await this.readState();
    const waiter = this.waiter;
    if (!waiter || waiter.generation !== generation || generation !== this.generation) return;
    if (waiter.predicate(state)) this.resolveWaiter(state);
  }

  private async pollActiveState(generation: number): Promise<void> {
    const state = await this.readState();
    if (this.active?.generation !== generation || generation !== this.generation) return;
    if (!state) return this.updateProgress(null);
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
    const state = await this.readState();
    if (this.active?.generation !== generation || generation !== this.generation) return;
    if (this.isRequestedTrackPlaying(state, this.active.spotifyUri)) return this.updateProgress(state);
    if (state && !this.isCurrentUri(state, this.active.spotifyUri)) this.armedSpotifyUri = null;
    this.clearRun();
    this.setPhase(this.armedSpotifyUri ? "armed" : "idle", "active playback state changed", this.requestedSpotifyUri ?? "unknown", state);
    this.callbacks.onPlaying(false);
  }

  private updateProgress(state: SnippetPlayerState | null): void {
    const active = this.active;
    if (!active) return;
    if (state && !state.paused) active.lastPositionMs = Math.max(active.lastPositionMs, state.position);
    const elapsed = Math.max(active.lastPositionMs, this.now() - active.startedAt);
    this.callbacks.onProgress(Math.min(elapsed, active.logicalDurationMs));
    if (elapsed >= active.logicalDurationMs) void this.finish(active.generation);
  }

  private scheduleCutoff(active: ActiveSnippet): void {
    if (this.hardStop) clearTimeout(this.hardStop);
    const elapsed = Math.max(active.lastPositionMs, this.now() - active.startedAt);
    this.hardStop = setTimeout(() => void this.finish(active.generation), Math.max(active.logicalDurationMs - elapsed, 0));
  }

  private async finish(generation: number): Promise<void> {
    const active = this.active;
    if (!active || active.generation !== generation || generation !== this.generation) return;
    this.callbacks.onProgress(active.logicalDurationMs);
    this.clearRun();
    this.setPhase("snippet-pausing", "audible deadline reached", active.spotifyUri);
    try {
      await this.muteTransport();
      if (generation !== this.generation) return;
      this.callbacks.onPlaying(false);
      const result = await this.pauseAndConfirm(generation, active.spotifyUri, "snippet pause");
      if (generation !== this.generation || result === "cancelled") return;
      if (result === "confirmed") {
        this.transportFaulted = false;
        await this.restoreUserVolume();
        this.setPhase(this.armedSpotifyUri === active.spotifyUri ? "armed" : "idle", "snippet pause confirmed", active.spotifyUri);
        return;
      }
      this.failSilent("Spotify did not confirm that playback stopped. Audio remains muted; press Pause to retry.", active.spotifyUri);
    } catch (error) {
      if (generation !== this.generation) return;
      this.failSilent(this.errorMessage(error), active.spotifyUri);
    }
  }

  private async pauseAndConfirm(generation: number, spotifyUri: string, phaseLabel: string): Promise<"confirmed" | "cancelled" | "failed"> {
    const deadline = this.now() + PAUSE_CONFIRM_TIMEOUT_MS;
    let attempts = 0;
    while (this.now() < deadline) {
      if (generation !== this.generation) return "cancelled";
      const state = await this.readState();
      if (state && !this.isRequestedTrackPlaying(state, spotifyUri)) {
        await this.delay(PAUSE_STABILIZATION_MS, generation).catch(() => undefined);
        if (generation !== this.generation) return "cancelled";
        const stableState = await this.readState();
        if (stableState && !this.isRequestedTrackPlaying(stableState, spotifyUri)) {
          this.debug(`${phaseLabel} confirmed`, spotifyUri, stableState);
          return "confirmed";
        }
      }
      if (attempts < PAUSE_CONFIRM_MAX_ATTEMPTS) {
        attempts += 1;
        this.assertAllowed(state, "pausing", "pause");
        await this.runOperation("pause", () => this.player.pause());
      }
      await this.delay(PAUSE_CONFIRM_INTERVAL_MS, generation).catch(() => undefined);
    }
    return generation === this.generation ? "failed" : "cancelled";
  }

  private async muteTransport(): Promise<void> {
    if (this.transportMuted) return;
    this.transportMuted = true;
    await this.runOperation("transport mute", () => this.player.setVolume(0));
  }

  private async restoreUserVolume(): Promise<void> {
    if (!this.transportMuted) return;
    await this.runOperation("volume restore", () => this.player.setVolume(this.userVolume));
    this.transportMuted = false;
  }

  private failSilent(message: string, spotifyUri: string): void {
    this.armedSpotifyUri = null;
    this.transportFaulted = true;
    this.transportMuted = true;
    this.callbacks.onPlaying(false);
    this.setPhase("failed", "transport stop was not confirmed", spotifyUri, undefined, message);
    this.callbacks.onStopError?.(message);
  }

  private failFromUnconfirmedStop(error: Error): void { this.failSilent(error.message, this.requestedSpotifyUri ?? "unknown"); }

  private async failFromOperation(error: unknown): Promise<void> {
    this.armedSpotifyUri = null;
    this.setPhase("failed", "playback operation failed", this.requestedSpotifyUri ?? "unknown", undefined, this.errorMessage(error));
    this.callbacks.onPlaying(false);
    if (this.transportMuted) this.transportFaulted = true;
    else await this.muteTransport().catch(() => undefined);
  }

  private async readState(): Promise<SnippetPlayerState | null> {
    const state = await this.player.getCurrentState().catch(() => null);
    this.callbacks.onState?.(state);
    return state;
  }

  private isRequestedTrackPlaying(state: SnippetPlayerState | null, spotifyUri: string): state is SnippetPlayerState {
    return Boolean(state && !state.paused && this.isCurrentUri(state, spotifyUri));
  }

  private isCurrentUri(state: SnippetPlayerState | null, spotifyUri: string): boolean {
    return Boolean(state && state.track_window?.current_track?.uri === spotifyUri);
  }

  private assertAllowed(state: SnippetPlayerState | null, restriction: keyof SnippetPlayerDisallows, operation: string): void {
    if (state?.disallows?.[restriction]) throw new Error(`Spotify disallows ${operation} during playback phase ${this.phase}.`);
  }

  private async runOperation<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (error) { throw new SpotifyPlaybackOperationError(operation, error); }
  }

  private beforeDeadline<T>(operation: Promise<T>, deadline: number): Promise<{ completed: true; value: T } | { completed: false }> {
    const remainingMs = Math.max(deadline - this.now(), 0);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve({ completed: false }), remainingMs);
      operation.then(
        (value) => { clearTimeout(timeout); resolve({ completed: true, value }); },
        (error) => { clearTimeout(timeout); reject(error); },
      );
    });
  }

  private delay(durationMs: number, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(() => generation === this.generation ? resolve() : reject(new PlaybackCancelledError()), durationMs);
    });
  }

  private ensureGeneration(generation: number): void {
    if (generation !== this.generation) throw new PlaybackCancelledError();
  }

  private clearRun(): void {
    if (this.progressPoll) clearInterval(this.progressPoll);
    if (this.hardStop) clearTimeout(this.hardStop);
    this.progressPoll = null;
    this.hardStop = null;
    this.active = null;
    this.primeAbort?.abort();
    this.primeAbort = null;
    this.rejectWaiter(new PlaybackCancelledError());
  }

  private resolveWaiter(state: SnippetPlayerState): void {
    const waiter = this.waiter;
    this.clearWaiterTimers();
    this.waiter = null;
    waiter?.resolve(state);
  }

  private rejectWaiter(error: Error): void {
    const waiter = this.waiter;
    this.clearWaiterTimers();
    this.waiter = null;
    waiter?.reject(error);
  }

  private clearWaiterTimers(): void {
    if (this.statePoll) clearInterval(this.statePoll);
    if (this.stateTimeout) clearTimeout(this.stateTimeout);
    this.statePoll = null;
    this.stateTimeout = null;
  }

  private setPhase(phase: PlaybackPhase, event: string, spotifyUri: string, state?: SnippetPlayerState | null, error?: string): void {
    this.phase = phase;
    this.callbacks.onPhase?.(phase);
    this.debug(event, spotifyUri, state, error);
  }

  private debug(event: string, spotifyUri: string, state?: SnippetPlayerState | null, error?: string): void {
    if (!PLAYBACK_DEBUG) return;
    console.debug("[spodle playback]", {
      event, phase: this.phase, elapsedMs: Math.round(this.now() - this.debugStartedAt), requestedUri: spotifyUri,
      currentUri: state?.track_window?.current_track?.uri ?? null, paused: state?.paused ?? null,
      position: state?.position ?? null, transportMuted: this.transportMuted, error: error ?? null,
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Spotify playback failed";
  }
}
