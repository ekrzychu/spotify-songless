import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SpotifySearchResponse, SpotifyTrack } from "@/lib/spotify/api";

const mocks = vi.hoisted(() => ({
  getSpotifySession: vi.fn(),
  spotifyFetch: vi.fn(),
}));

vi.mock("@/lib/spotify/auth", () => ({ getSpotifySession: mocks.getSpotifySession }));
vi.mock("@/lib/spotify/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/spotify/api")>(),
  spotifyFetch: mocks.spotifyFetch,
}));

import { GET } from "@/app/api/spotify/search/route";

function track(id: string, title: string, artist: string, albumName = "Album"): SpotifyTrack {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: title,
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
    artists: [{ id: `${id}-artist`, name: artist }],
    album: { name: albumName },
  };
}

function spotifyResponse(items: SpotifyTrack[]): SpotifySearchResponse {
  return { tracks: { items, next: null, total: items.length } };
}

function request(query: string): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000/api/spotify/search?q=${encodeURIComponent(query)}`);
}

describe("strict Spotify guess search API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSpotifySession.mockResolvedValue({ accessToken: "token" });
    mocks.spotifyFetch.mockResolvedValue(spotifyResponse([
      track("hello", "Hello", "Adele"),
      track("other", "Some Song", "Other Artist", "Hello From The Other Side"),
    ]));
  });

  it("rejects Spotify relevance results whose visible fields lack query tokens", async () => {
    const response = await GET(request("hello from the other side"));
    await expect(response.json()).resolves.toMatchObject({ items: [] });
  });

  it("returns a candidate when all query tokens occur in title and artist", async () => {
    const response = await GET(request("hello adele"));
    const payload = await response.json() as { items: Array<{ title: string; artistNames: string }> };
    expect(payload.items).toEqual([expect.objectContaining({ title: "Hello", artistNames: "Adele" })]);

    const spotifyPath = mocks.spotifyFetch.mock.calls[0]?.[1] as string;
    const params = new URL(`https://api.spotify.test${spotifyPath}`).searchParams;
    expect(params.get("limit")).toBe("10");
  });
});
