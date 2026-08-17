"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PlayerStatus = "loading" | "ready" | "offline" | "error";

export function useSpotifyPlayer(enabled: boolean) {
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const timerRef = useRef<number | null>(null);
  const monitorRef = useRef<number | null>(null);
  const [status, setStatus] = useState<PlayerStatus>(enabled ? "loading" : "offline");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (monitorRef.current) window.clearInterval(monitorRef.current);
    timerRef.current = null;
    monitorRef.current = null;
  }, []);

  const pause = useCallback(async () => {
    clearTimers();
    await playerRef.current?.pause();
    setPlaying(false);
  }, [clearTimers]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const initialize = () => {
      if (disposed || !window.Spotify || playerRef.current) return;
      const player = new window.Spotify.Player({
        name: "Needle Drop",
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
      player.addListener("ready", ({ device_id }) => {
        setDeviceId(device_id); setStatus("ready"); setError(null);
      });
      player.addListener("not_ready", () => { setStatus("offline"); setDeviceId(null); });
      player.addListener("player_state_changed", (state) => setPlaying(Boolean(state && !state.paused)));
      player.addListener("account_error", () => { setStatus("error"); setError("Spotify Premium is required for browser playback."); });
      player.addListener("authentication_error", () => { setStatus("error"); setError("Spotify needs to be reconnected."); });
      player.addListener("initialization_error", () => { setStatus("error"); setError("This browser could not initialize Spotify playback."); });
      player.addListener("playback_error", () => { setPlaying(false); setError("This track could not be played."); });
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
      disposed = true; clearTimers(); playerRef.current?.disconnect(); playerRef.current = null;
    };
  }, [enabled, clearTimers]);

  const playSnippet = useCallback(async (spotifyUri: string, durationSeconds: number) => {
    const player = playerRef.current;
    if (!player || !deviceId || status !== "ready") throw new Error("Spotify player is not ready");
    clearTimers(); setProgress(0); setError(null);
    await player.activateElement();
    await player.pause().catch(() => undefined);
    await player.seek(0).catch(() => undefined);
    const response = await fetch("/api/spotify/playback", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, spotifyUri, positionMs: 0 }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
      throw new Error(payload?.code === "track_unavailable" ? "TRACK_UNAVAILABLE" : payload?.error ?? "Playback failed");
    }
    setPlaying(true);
    const durationMs = durationSeconds * 1000;
    const startedAt = performance.now();
    timerRef.current = window.setTimeout(() => void pause(), durationMs);
    monitorRef.current = window.setInterval(() => {
      void player.getCurrentState().then((state) => {
        if (!state || state.paused) return;
        const elapsed = Math.max(state.position, performance.now() - startedAt);
        setProgress(Math.min(elapsed / durationMs, 1));
        if (elapsed >= durationMs) void pause();
      });
    }, 40);
  }, [clearTimers, deviceId, pause, status]);

  return { status, playing, progress, error, playSnippet, pause, ready: status === "ready" };
}
