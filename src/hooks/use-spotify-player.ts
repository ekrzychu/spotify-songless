"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SnippetPlaybackController, spotifyPlaybackStartPayload } from "@/lib/spotify/snippet-playback";

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
  const [status, setStatus] = useState<PlayerStatus>(enabled ? "loading" : "offline");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progressMs, setProgressMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const pause = useCallback(async () => {
    if (controllerRef.current) await controllerRef.current.stop(false);
    else await playerRef.current?.pause();
  }, []);

  const resetPlayback = useCallback(async () => {
    if (controllerRef.current) await controllerRef.current.stop(true);
    else {
      setProgressMs(0);
      await playerRef.current?.pause();
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const initialize = () => {
      if (disposed || !window.Spotify || playerRef.current) return;
      const player = new window.Spotify.Player({
        name: "spodle",
        volume: 0.65,
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
        onStopError: setError,
      });
      controllerRef.current = controller;
      player.addListener("ready", ({ device_id }) => {
        setDeviceId(device_id); setStatus("ready"); setError(null);
      });
      player.addListener("not_ready", () => { setStatus("offline"); setDeviceId(null); });
      player.addListener("player_state_changed", (state) => controller.handleState(state));
      player.addListener("account_error", () => { setStatus("error"); setError("Spotify Premium is required for browser playback."); });
      player.addListener("authentication_error", () => { setStatus("error"); setError("Spotify needs to be reconnected."); });
      player.addListener("initialization_error", () => { setStatus("error"); setError("This browser could not initialize Spotify playback."); });
      player.addListener("playback_error", () => { void controller.stop(false); setError("This track could not be played."); });
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
    await controller.play(spotifyUri, durationMs, async () => {
      const response = await fetch("/api/spotify/playback", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spotifyPlaybackStartPayload(deviceId, spotifyUri)),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
        throw new PlaybackRequestError(payload?.code ?? "playback_failed", payload?.error ?? "Playback failed");
      }
    });
  }, [deviceId, status]);

  return { status, playing, progressMs, error, playSnippet, pause, resetPlayback, ready: status === "ready" };
}
