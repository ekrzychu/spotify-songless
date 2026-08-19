import { describe, expect, it } from "vitest";
import { artworkFromState, artworkUrlForUri } from "@/hooks/use-spotify-player";

describe("Spotify SDK artwork", () => {
  it("selects the largest Spotify CDN image and keys it to the current URI", () => {
    expect(artworkFromState({
      paused: false,
      position: 0,
      track_window: { current_track: {
        id: "track-id",
        uri: "spotify:track:track-id",
        name: "Song",
        album: {
          name: "Album",
          images: [
            { url: "https://i.scdn.co/image/small123", width: 64, height: 64 },
            { url: "https://i.scdn.co/image/large456", width: 640, height: 640 },
          ],
        },
        artists: [{ name: "Artist" }],
      } },
    })).toEqual({ spotifyUri: "spotify:track:track-id", url: "https://i.scdn.co/image/large456" });
  });

  it("does not accept arbitrary artwork hosts", () => {
    expect(artworkFromState({
      paused: true,
      position: 0,
      track_window: { current_track: {
        uri: "spotify:track:track-id",
        album: { images: [{ url: "https://example.com/answer.jpg", width: 640, height: 640 }] },
      } },
    })).toEqual({ spotifyUri: "spotify:track:track-id", url: null });
  });

  it("returns no artwork identity when SDK state has no current track", () => {
    expect(artworkFromState(null)).toBeNull();
    expect(artworkFromState({ paused: true, position: 0 })).toBeNull();
  });

  it("rejects stale artwork from the previous Spotify URI", () => {
    const artwork = { spotifyUri: "spotify:track:old", url: "https://i.scdn.co/image/old123" };
    expect(artworkUrlForUri(artwork, "spotify:track:new")).toBeNull();
    expect(artworkUrlForUri(artwork, "spotify:track:old")).toBe(artwork.url);
  });
});
