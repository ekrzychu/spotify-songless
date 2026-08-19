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

function isOneEditFromWordPrefix(token: string, word: string): boolean {
  if (token.length < 4) return false;
  const prefix = word.slice(0, token.length);
  if (Math.abs(token.length - prefix.length) > 1) return false;

  let tokenIndex = 0;
  let prefixIndex = 0;
  let edits = 0;
  while (tokenIndex < token.length && prefixIndex < prefix.length) {
    if (token[tokenIndex] === prefix[prefixIndex]) {
      tokenIndex += 1;
      prefixIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (token.length > prefix.length) tokenIndex += 1;
    else if (prefix.length > token.length) prefixIndex += 1;
    else {
      tokenIndex += 1;
      prefixIndex += 1;
    }
  }
  return edits + (token.length - tokenIndex) + (prefix.length - prefixIndex) <= 1;
}

export function visibleTrackMatchRank(query: string, fields: VisibleTrackFields): number | null {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return null;

  const title = normalizeSearchText(fields.title);
  const artists = fields.artistNames.map(normalizeSearchText).filter(Boolean);
  const visibleWords = [title, ...artists].flatMap((value) => value.split(" ").filter(Boolean));
  const queryTokens = normalizedQuery.split(" ");
  const exactTokenMatch = queryTokens.every((token) => visibleWords.some((word) => word.startsWith(token)));
  const fuzzyTokenMatch = queryTokens.every((token) => (
    visibleWords.some((word) => word.startsWith(token) || isOneEditFromWordPrefix(token, word))
  ));
  if (!fuzzyTokenMatch) return null;

  if (title === normalizedQuery) return 0;
  if (title.startsWith(normalizedQuery)) return 1;
  if (title.includes(normalizedQuery)) return 2;
  if (artists.some((artist) => artist === normalizedQuery)) return 3;
  if (artists.some((artist) => artist.startsWith(normalizedQuery))) return 4;
  if (artists.some((artist) => artist.includes(normalizedQuery))) return 5;
  return exactTokenMatch ? 6 : 7;
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
