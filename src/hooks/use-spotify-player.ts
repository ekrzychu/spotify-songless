"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { persistVolumePercent, readStoredVolumePercent } from "@/lib/client/volume";
import {
  SnippetPlaybackController,
  isPlaybackBusyPhase,
  spotifyPlaybackStartPayload,
  type PlaybackPhase,
  type SnippetPlayerState,
} from "@/lib/spotify/snippet-playback";

type PlayerStatus = "loading" | "ready" | "offline" | "error";

export class PlaybackRequestError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PlaybackRequestError";
  }
}

export type CurrentTrackArtwork = { spotifyUri: string; url: string | null };

export function artworkFromState(state: SnippetPlayerState | null): CurrentTrackArtwork | null {
  const track = state?.track_window?.current_track;
  if (!track?.uri) return null;
  const image = track.album?.images
    ?.filter((candidate) => /^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]+$/.test(candidate.url))
    .sort((left, right) => (right.width ?? 0) - (left.width ?? 0))[0];
  return { spotifyUri: track.uri, url: image?.url ?? null };
}

export function artworkUrlForUri(artwork: CurrentTrackArtwork | null, spotifyUri: string): string | null {
  return artwork?.spotifyUri === spotifyUri ? artwork.url : null;
}

export function useSpotifyPlayer(enabled: boolean) {
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const controllerRef = useRef<SnippetPlaybackController | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const activationPromiseRef = useRef<Promise<void> | null>(null);
  const activatedRef = useRef(false);
  const [status, setStatus] = useState<PlayerStatus>(enabled ? "loading" : "offline");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState<PlaybackPhase>("idle");
  const [progressMs, setProgressMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [volumePercent, setVolumePercent] = useState(65);
  const [currentTrackArtwork, setCurrentTrackArtwork] = useState<CurrentTrackArtwork | null>(null);

  const activateForUserGesture = useCallback(() => {
    const player = playerRef.current;
    if (!player || activatedRef.current || activationPromiseRef.current) return;
    const activation = player.activateElement();
    activationPromiseRef.current = activation;
    void activation.then(() => {
      activatedRef.current = true;
    }).catch(() => {
      setError("Press Play again to allow audio in this browser.");
    }).finally(() => {
      if (activationPromiseRef.current === activation) activationPromiseRef.current = null;
    });
  }, []);

  const pause = useCallback(async () => {
    if (controllerRef.current) return controllerRef.current.stop(false);
    await playerRef.current?.pause();
    return true;
  }, []);

  const resetPlayback = useCallback(async () => {
    if (controllerRef.current) return controllerRef.current.stop(true);
    else {
      setProgressMs(0);
      await playerRef.current?.pause();
      return true;
    }
  }, []);

  const invalidateArm = useCallback(() => {
    controllerRef.current?.invalidateArm();
  }, []);

  const setVolume = useCallback(async (nextVolume: number) => {
    const normalized = persistVolumePercent(nextVolume);
    setVolumePercent(normalized);
    try {
      if (controllerRef.current) await controllerRef.current.setUserVolume(normalized / 100);
      else await playerRef.current?.setVolume(normalized / 100);
    } catch (volumeError) {
      if (process.env.NODE_ENV === "development") console.error("Spotify volume update failed", volumeError);
      setError("Spotify volume could not be changed.");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const initialize = () => {
      if (disposed || !window.Spotify || playerRef.current) return;
      const initialVolume = readStoredVolumePercent();
      setVolumePercent(initialVolume);
      const player = new window.Spotify.Player({
        name: "spodle",
        volume: initialVolume / 100,
        enableMediaSession: false,
        getOAuthToken: (callback) => {
          void fetch("/api/auth/token", { cache: "no-store" })
            .then((response) => {
              if (!response.ok) throw new Error();
              return response.json() as Promise<{ accessToken: string }>;
            })
            .then(({ accessToken }) => callback(accessToken))
            .catch(() => { setStatus("error"); setError("Spotify needs to be reconnected."); });
        },
      });
      playerRef.current = player;
      const controller = new SnippetPlaybackController(player, {
        onPlaying: setPlaying,
        onProgress: setProgressMs,
        onPhase: setPhase,
        onState: (state) => {
          const artwork = artworkFromState(state);
          if (artwork) setCurrentTrackArtwork(artwork);
        },
        onStopError: setError,
      });
      void controller.setUserVolume(initialVolume / 100).catch(() => undefined);
      controllerRef.current = controller;
      player.addListener("ready", ({ device_id }) => {
        deviceIdRef.current = device_id;
        setDeviceId(device_id); setStatus("ready"); setError(null);
      });
      player.addListener("not_ready", () => {
        controller.invalidateArm();
        void controller.stop(false);
        deviceIdRef.current = null;
        activatedRef.current = false;
        activationPromiseRef.current = null;
        setStatus("offline"); setDeviceId(null);
      });
      player.addListener("player_state_changed", (state) => controller.handleState(state));
      player.addListener("account_error", () => { setStatus("error"); setError("Spotify Premium is required for browser playback."); });
      player.addListener("authentication_error", () => { setStatus("error"); setError("Spotify needs to be reconnected."); });
      player.addListener("initialization_error", () => { setStatus("error"); setError("This browser could not initialize Spotify playback."); });
      player.addListener("playback_error", ({ message }) => {
        const failure = controller.failFromSdk(message);
        if (process.env.NODE_ENV === "development") {
          void player.getCurrentState().catch(() => null).then((state) => {
            console.error("[spodle spotify playback_error]", {
              message,
              phase: failure.phase,
              requestedUri: failure.requestedUri,
              armedUri: failure.armedUri,
              currentUri: state?.track_window?.current_track?.uri ?? null,
              paused: state?.paused ?? null,
              position: state?.position ?? null,
              disallows: state?.disallows ?? null,
            });
          });
        }
        setError(process.env.NODE_ENV === "development"
          ? `Spotify playback failed: ${message}`
          : "This track could not be played.");
      });
      player.addListener("autoplay_failed", () => setError("Press Play again to allow audio in this browser."));
      void player.connect().then((connected) => { if (!connected) setStatus("error"); });
    };
    if (window.Spotify) initialize();
    else {
      window.onSpotifyWebPlaybackSDKReady = initialize;
      if (!document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
        const script = document.createElement("script");
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        document.body.appendChild(script);
      }
    }
    return () => {
      disposed = true;
      const player = playerRef.current;
      const controller = controllerRef.current;
      controllerRef.current = null;
      playerRef.current = null;
      deviceIdRef.current = null;
      activatedRef.current = false;
      activationPromiseRef.current = null;
      if (controller && player) void controller.stop(false).finally(() => player.disconnect());
      else player?.disconnect();
    };
  }, [enabled]);

  const playSnippet = useCallback(async (spotifyUri: string, durationSeconds: number) => {
    const player = playerRef.current;
    if (!player || !deviceId || status !== "ready") throw new Error("Spotify player is not ready");
    const durationMs = durationSeconds * 1000;
    setError(null);
    setCurrentTrackArtwork((current) => current?.spotifyUri === spotifyUri ? current : null);
    if (!activatedRef.current) {
      const activation = activationPromiseRef.current;
      if (!activation) throw new Error("Press Play again to activate Spotify audio.");
      await activation;
    }
    const controller = controllerRef.current;
    if (!controller) throw new Error("Spotify player is not ready");
    await controller.play({ spotifyUri, logicalDurationMs: durationMs, primeTrack: async (signal) => {
      const response = await fetch("/api/spotify/playback", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spotifyPlaybackStartPayload(deviceId, spotifyUri)),
        signal,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
        throw new PlaybackRequestError(payload?.code ?? "playback_failed", payload?.error ?? "Playback failed");
      }
    } });
  }, [deviceId, status]);

  const extendSnippet = useCallback((durationSeconds: number) => (
    controllerRef.current?.extendActiveSnippet(durationSeconds * 1000) ?? false
  ), []);

  return {
    status,
    playing,
    phase,
    busy: isPlaybackBusyPhase(phase),
    progressMs,
    volumePercent,
    error,
    currentTrackArtwork,
    playSnippet,
    extendSnippet,
    audiblyPlaying: playing && phase === "snippet-playing",
    activateForUserGesture,
    pause,
    resetPlayback,
    invalidateArm,
    setVolume,
    ready: status === "ready",
  };
}
