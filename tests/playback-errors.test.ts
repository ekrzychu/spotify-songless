import { describe, expect, it } from "vitest";
import { SpotifyApiError } from "@/lib/spotify/api";
import { classifyPlaybackError } from "@/lib/spotify/playback-errors";

const error = (status: number, message: string | null = null, reason: string | null = null) =>
  new SpotifyApiError(status, message, reason, null);

describe("Spotify playback error classification", () => {
  it("distinguishes authentication errors", () => expect(classifyPlaybackError(error(401))).toBe("spotify_reconnect_required"));
  it("distinguishes device errors", () => expect(classifyPlaybackError(error(404, "Device not found"))).toBe("device_unavailable"));
  it("distinguishes rate limits", () => expect(classifyPlaybackError(error(429))).toBe("spotify_rate_limited"));
  it("distinguishes explicit unavailable tracks", () => expect(classifyPlaybackError(error(403, "Track is not playable"))).toBe("track_unavailable"));
  it("does not classify every 403 or 404 as unavailable", () => {
    expect(classifyPlaybackError(error(403, "Forbidden"))).toBe("playback_failed");
    expect(classifyPlaybackError(error(404, "Not found"))).toBe("playback_failed");
  });
  it("distinguishes Premium account errors", () => expect(classifyPlaybackError(error(403, "Premium required"))).toBe("premium_required"));
});
