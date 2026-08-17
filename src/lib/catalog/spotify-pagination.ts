import type { SpotifySearchResponse, SpotifyTrack } from "@/lib/spotify/api";

export const SPOTIFY_SEARCH_LIMIT = 10;
export const SPOTIFY_MAX_SEARCH_OFFSET = 1_000;

export type SearchPageFetcher = (input: { offset: number; limit: number }) => Promise<SpotifySearchResponse>;

export async function paginateSpotifySearch(
  fetchPage: SearchPageFetcher,
  requestedResults: number,
): Promise<{ items: SpotifyTrack[]; requests: number }> {
  const target = Math.min(Math.max(Math.floor(requestedResults), 1), SPOTIFY_MAX_SEARCH_OFFSET);
  const items: SpotifyTrack[] = [];
  let requests = 0;
  let offset = 0;
  while (items.length < target && offset <= SPOTIFY_MAX_SEARCH_OFFSET) {
    const limit = Math.min(SPOTIFY_SEARCH_LIMIT, target - items.length);
    const response = await fetchPage({ offset, limit });
    requests += 1;
    const pageItems = response.tracks.items;
    items.push(...pageItems);
    if (!response.tracks.next || pageItems.length === 0) break;
    offset += pageItems.length;
  }
  return { items, requests };
}
