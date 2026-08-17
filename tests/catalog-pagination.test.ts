import { describe, expect, it, vi } from "vitest";
import { paginateSpotifySearch, SPOTIFY_SEARCH_LIMIT } from "@/lib/catalog/spotify-pagination";
import type { SpotifySearchResponse, SpotifyTrack } from "@/lib/spotify/api";

const track = (id: string) => ({ id } as SpotifyTrack);
const page = (ids: string[], next: string | null): SpotifySearchResponse => ({
  tracks: { items: ids.map(track), next, total: 100 },
});

describe("Spotify catalog pagination", () => {
  it("never requests more than the Development Mode maximum", async () => {
    const fetchPage = vi.fn().mockResolvedValue(page([], null));
    await paginateSpotifySearch(fetchPage, 100);
    expect(fetchPage.mock.calls[0]?.[0].limit).toBe(SPOTIFY_SEARCH_LIMIT);
    expect(SPOTIFY_SEARCH_LIMIT).toBe(10);
  });

  it("advances offsets by the actual page size", async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(["1", "2", "3"], "next"))
      .mockResolvedValueOnce(page(["4"], null));
    await paginateSpotifySearch(fetchPage, 20);
    expect(fetchPage.mock.calls.map(([input]) => input.offset)).toEqual([0, 3]);
  });

  it("stops when Spotify has no next page", async () => {
    const fetchPage = vi.fn().mockResolvedValue(page(["1"], null));
    const result = await paginateSpotifySearch(fetchPage, 100);
    expect(result).toMatchObject({ requests: 1 });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
