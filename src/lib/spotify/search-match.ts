export type VisibleTrackFields = {
  title: string;
  artistNames: readonly string[];
};

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function visibleTrackMatchRank(query: string, fields: VisibleTrackFields): number | null {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return null;

  const title = normalizeSearchText(fields.title);
  const artists = fields.artistNames.map(normalizeSearchText).filter(Boolean);
  const visibleWords = [title, ...artists].flatMap((value) => value.split(" ").filter(Boolean));
  const queryTokens = normalizedQuery.split(" ");
  if (!queryTokens.every((token) => visibleWords.some((word) => word.startsWith(token)))) return null;

  if (title === normalizedQuery) return 0;
  if (artists.some((artist) => artist === normalizedQuery)) return 1;
  if (title.startsWith(normalizedQuery)) return 2;
  if (artists.some((artist) => artist.startsWith(normalizedQuery))) return 3;
  if (title.includes(normalizedQuery)) return 4;
  if (artists.some((artist) => artist.includes(normalizedQuery))) return 5;
  return 6;
}

export function matchesVisibleTrack(query: string, fields: VisibleTrackFields): boolean {
  return visibleTrackMatchRank(query, fields) !== null;
}

export function rankAndDedupeVisibleTracks<T>(
  query: string,
  tracks: readonly T[],
  visibleFields: (track: T) => VisibleTrackFields,
  limit = 8,
): T[] {
  const ranked = tracks
    .map((track, index) => ({ track, index, fields: visibleFields(track) }))
    .map((candidate) => ({ ...candidate, rank: visibleTrackMatchRank(query, candidate.fields) }))
    .filter((candidate): candidate is typeof candidate & { rank: number } => candidate.rank !== null)
    .sort((left, right) => left.rank - right.rank || left.index - right.index);

  const seen = new Set<string>();
  const results: T[] = [];
  for (const candidate of ranked) {
    const key = [
      normalizeSearchText(candidate.fields.title),
      ...candidate.fields.artistNames.map(normalizeSearchText),
    ].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(candidate.track);
    if (results.length >= limit) break;
  }
  return results;
}
