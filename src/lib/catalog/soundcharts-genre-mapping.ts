import type { SoundchartsSongGenre } from "@/lib/soundcharts/client";

export const SOUNDCHARTS_ACTIVE_GENRE_ALIASES = {
  pop: ["pop"],
  rock: ["rock"],
  "hip-hop": ["hip hop", "hip-hop", "hiphop", "rap"],
  "r-and-b": ["r&b", "rnb", "rhythm and blues", "soul"],
  electronic: ["electronic", "electro", "dance", "edm", "e.d.m.", "house", "techno", "trance"],
  classical: ["classical"],
} as const;

export type MappedActiveGenreId = keyof typeof SOUNDCHARTS_ACTIVE_GENRE_ALIASES;
export type SoundchartsGenreEvidence = { root: string; sub: readonly string[] };

export function normalizeSoundchartsGenre(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/gu, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

const ACTIVE_GENRE_BY_ALIAS = new Map<string, MappedActiveGenreId>(
  Object.entries(SOUNDCHARTS_ACTIVE_GENRE_ALIASES).flatMap(([categoryId, aliases]) => (
    aliases.map((alias) => [
      normalizeSoundchartsGenre(alias),
      categoryId as MappedActiveGenreId,
    ] as const)
  )),
);

export function mapSoundchartsGenresToActiveCategories(
  genres: readonly SoundchartsGenreEvidence[],
): MappedActiveGenreId[] {
  const mapped = new Set<MappedActiveGenreId>();
  for (const value of genres.flatMap((genre) => [genre.root, ...genre.sub])) {
    const categoryId = ACTIVE_GENRE_BY_ALIAS.get(normalizeSoundchartsGenre(value));
    if (categoryId) mapped.add(categoryId);
  }
  return Object.keys(SOUNDCHARTS_ACTIVE_GENRE_ALIASES)
    .filter((categoryId): categoryId is MappedActiveGenreId => mapped.has(categoryId as MappedActiveGenreId));
}

export function parseStoredSoundchartsGenres(value: string | null): SoundchartsSongGenre[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    return parsed.flatMap((raw): SoundchartsSongGenre[] => {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
      const genre = raw as Record<string, unknown>;
      const root = typeof genre.root === "string" ? genre.root.trim() : "";
      if (!root) return [];
      const sub = Array.isArray(genre.sub)
        ? genre.sub.flatMap((item) => (
          typeof item === "string" && item.trim().length > 0 ? [item.trim()] : []
        ))
        : [];
      return [{ root, sub }];
    });
  } catch {
    return null;
  }
}
