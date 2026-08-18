"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { persistVolumePercent, readStoredVolumePercent } from "@/lib/client/volume";
import {
  SnippetPlaybackController,
  isPlaybackBusyPhase,
  spotifyPlaybackPausePayload,
  spotifyPlaybackStartPayload,
  type PlaybackPhase,
} from "@/lib/spotify/snippet-playback";

type PlayerStatus = "loading" | "ready" | "offline" | "error";

export class PlaybackRequestError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PlaybackRequestError";
  }
}

export function useSpotifyPlayer(enabled: boolean) {
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const controllerRef = useRef<SnippetPlaybackController | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<PlayerStatus>(enabled ? "loading" : "offline");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState<PlaybackPhase>("idle");
  const [progressMs, setProgressMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [volumePercent, setVolumePercent] = useState(65);

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
      await playerRef.current?.setVolume(normalized / 100);
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
        onStopError: setError,
      }, undefined, {
        pauseRemotely: async () => {
          const currentDeviceId = deviceIdRef.current;
          if (!currentDeviceId) throw new Error("Spotify playback device is unavailable.");
          const response = await fetch("/api/spotify/playback/pause", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(spotifyPlaybackPausePayload(currentDeviceId)),
          });
          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
            throw new PlaybackRequestError(payload?.code ?? "playback_failed", payload?.error ?? "Playback could not be paused");
          }
        },
      });
      controllerRef.current = controller;
      player.addListener("ready", ({ device_id }) => {
        deviceIdRef.current = device_id;
        setDeviceId(device_id); setStatus("ready"); setError(null);
      });
      player.addListener("not_ready", () => {
        controller.invalidateArm();
        void controller.stop(false);
        deviceIdRef.current = null;
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
      if (controller && player) void controller.stop(false).finally(() => player.disconnect());
      else player?.disconnect();
    };
  }, [enabled]);

  const playSnippet = useCallback(async (spotifyUri: string, durationSeconds: number) => {
    const player = playerRef.current;
    if (!player || !deviceId || status !== "ready") throw new Error("Spotify player is not ready");
    const durationMs = durationSeconds * 1000;
    setError(null);
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

  return {
    status,
    playing,
    phase,
    busy: isPlaybackBusyPhase(phase),
    progressMs,
    volumePercent,
    error,
    playSnippet,
    pause,
    resetPlayback,
    invalidateArm,
    setVolume,
    ready: status === "ready",
  };
}
