import { SpotifyApiError } from "@/lib/spotify/api";

export type PlaybackErrorCode =
  | "track_unavailable"
  | "device_unavailable"
  | "spotify_reconnect_required"
  | "premium_required"
  | "spotify_rate_limited"
  | "playback_failed";

export function classifyPlaybackError(error: unknown): PlaybackErrorCode {
  if (!(error instanceof SpotifyApiError)) return "playback_failed";
  if (error.status === 401) return "spotify_reconnect_required";
  if (error.status === 429) return "spotify_rate_limited";
  const details = `${error.reason ?? ""} ${error.spotifyMessage ?? ""}`.toLowerCase();
  if (details.includes("premium") || details.includes("account restriction")) return "premium_required";
  if (
    details.includes("no_active_device")
    || details.includes("device_not_found")
    || details.includes("device not found")
    || details.includes("no active device")
  ) return "device_unavailable";
  if (
    details.includes("track_unavailable")
    || details.includes("track unavailable")
    || details.includes("track is not playable")
    || details.includes("restriction violated")
  ) return "track_unavailable";
  return "playback_failed";
}

export const PLAYBACK_ERROR_RESPONSES: Record<PlaybackErrorCode, { status: number; message: string }> = {
  track_unavailable: { status: 409, message: "This track is unavailable for this playback session." },
  device_unavailable: { status: 409, message: "The spodle player is not available. Wait a moment and try again." },
  spotify_reconnect_required: { status: 401, message: "Spotify needs to be reconnected." },
  premium_required: { status: 403, message: "Spotify Premium is required for browser playback." },
  spotify_rate_limited: { status: 429, message: "Spotify is busy right now. Try again shortly." },
  playback_failed: { status: 502, message: "Playback could not start. Try again." },
};
