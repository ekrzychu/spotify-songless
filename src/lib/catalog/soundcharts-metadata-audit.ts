import { CATEGORIES } from "@/lib/catalog/category-config";
import type { SoundchartsSongGenre } from "@/lib/soundcharts/client";

const ACTIVE_GENRES = CATEGORIES.filter((category) => category.type === "genre");

export type SoundchartsMetadataAuditTrack = {
  id: string;
  spotifyTrackId: string;
  title: string;
  artistNames: string;
  releaseDate: string | null;
  soundchartsReleaseDate: string | null;
  soundchartsGenresJson: string | null;
  streamCount: bigint | null;
  categories: ReadonlyArray<{ categoryId: string }>;
};

export type SoundchartsMetadataAudit = {
  metadataBearingTracks: number;
  sameYear: number;
  differentYear: number;
  differentDecade: number;
  missingSpotifyDate: number;
  missingSoundchartsDate: number;
  differentDecadeExamples: Array<{
    title: string;
    artistNames: string;
    spotifyReleaseDate: string;
    soundchartsReleaseDate: string;
  }>;
  rootGenres: Array<{ value: string; count: number }>;
  subgenres: Array<{ value: string; count: number }>;
  potentialMismatches: Array<{
    title: string;
    artistNames: string;
    localGenres: string[];
    soundchartsRootGenres: string[];
  }>;
};

function releaseYear(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{4})(?:\D|$)/u.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isSafeInteger(year) && year >= 1 && year <= 9999 ? year : null;
}

function parseGenres(value: string | null): SoundchartsSongGenre[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((raw): SoundchartsSongGenre[] => {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
      const genre = raw as Record<string, unknown>;
      const root = typeof genre.root === "string" ? genre.root.trim() : "";
      if (!root) return [];
      const sub = Array.isArray(genre.sub)
        ? genre.sub.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim())
        : [];
      return [{ root, sub }];
    });
  } catch {
    return [];
  }
}

function normalizeGenre(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function increment(counter: Map<string, number>, values: Iterable<string>): void {
  for (const value of new Set(values)) counter.set(value, (counter.get(value) ?? 0) + 1);
}

function sortedCounts(counter: Map<string, number>): Array<{ value: string; count: number }> {
  return [...counter].map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

export function buildSoundchartsMetadataAudit(
  tracks: readonly SoundchartsMetadataAuditTrack[],
  exampleLimit = 20,
): SoundchartsMetadataAudit {
  const rootCounts = new Map<string, number>();
  const subgenreCounts = new Map<string, number>();
  const differentDecadeExamples: SoundchartsMetadataAudit["differentDecadeExamples"] = [];
  const potentialMismatches: SoundchartsMetadataAudit["potentialMismatches"] = [];
  let sameYear = 0;
  let differentYear = 0;
  let differentDecade = 0;
  let missingSpotifyDate = 0;
  let missingSoundchartsDate = 0;
  const metadataTracks = [...tracks]
    .filter((track) => Boolean(track.soundchartsReleaseDate || track.soundchartsGenresJson))
    .sort((left, right) => left.spotifyTrackId.localeCompare(right.spotifyTrackId));

  for (const track of metadataTracks) {
    const spotifyYear = releaseYear(track.releaseDate);
    const soundchartsYear = releaseYear(track.soundchartsReleaseDate);
    if (spotifyYear === null) missingSpotifyDate += 1;
    if (soundchartsYear === null) missingSoundchartsDate += 1;
    if (spotifyYear !== null && soundchartsYear !== null) {
      if (spotifyYear === soundchartsYear) sameYear += 1;
      else {
        differentYear += 1;
        if (Math.floor(spotifyYear / 10) !== Math.floor(soundchartsYear / 10)) {
          differentDecade += 1;
          if (differentDecadeExamples.length < exampleLimit) {
            differentDecadeExamples.push({
              title: track.title,
              artistNames: track.artistNames,
              spotifyReleaseDate: track.releaseDate!,
              soundchartsReleaseDate: track.soundchartsReleaseDate!,
            });
          }
        }
      }
    }

    const genres = parseGenres(track.soundchartsGenresJson);
    increment(rootCounts, genres.map((genre) => genre.root));
    increment(subgenreCounts, genres.flatMap((genre) => genre.sub));
    if (track.streamCount !== null && genres.length > 0 && potentialMismatches.length < exampleLimit) {
      const localGenres = ACTIVE_GENRES.filter((genre) => (
        track.categories.some((relation) => relation.categoryId === genre.id)
      ));
      const localNames = new Set(localGenres.flatMap((genre) => [
        normalizeGenre(genre.id),
        normalizeGenre(genre.label),
      ]));
      const roots = [...new Set(genres.map((genre) => genre.root))];
      const hasExactMatch = roots.some((root) => localNames.has(normalizeGenre(root)));
      if (!hasExactMatch) {
        potentialMismatches.push({
          title: track.title,
          artistNames: track.artistNames,
          localGenres: localGenres.map((genre) => genre.label),
          soundchartsRootGenres: roots,
        });
      }
    }
  }

  return {
    metadataBearingTracks: metadataTracks.length,
    sameYear,
    differentYear,
    differentDecade,
    missingSpotifyDate,
    missingSoundchartsDate,
    differentDecadeExamples,
    rootGenres: sortedCounts(rootCounts),
    subgenres: sortedCounts(subgenreCounts),
    potentialMismatches,
  };
}

export function formatSoundchartsMetadataAudit(audit: SoundchartsMetadataAudit): string {
  return [
    "SOUNDCHARTS METADATA AUDIT",
    "",
    `Metadata-bearing tracks: ${audit.metadataBearingTracks}`,
    `Same release year: ${audit.sameYear}`,
    `Different release year: ${audit.differentYear}`,
    `Different decade: ${audit.differentDecade}`,
    `Missing Spotify release date: ${audit.missingSpotifyDate}`,
    `Missing Soundcharts release date: ${audit.missingSoundchartsDate}`,
    "",
    "DIFFERENT-DECADE EXAMPLES",
    ...audit.differentDecadeExamples.map((example) => (
      `  - ${example.title} - ${example.artistNames}: Spotify ${example.spotifyReleaseDate}; Soundcharts ${example.soundchartsReleaseDate}`
    )),
    ...(audit.differentDecadeExamples.length === 0 ? ["  None"] : []),
    "",
    "SOUNDCHARTS ROOT GENRES",
    ...audit.rootGenres.map(({ value, count }) => `  ${value}: ${count}`),
    ...(audit.rootGenres.length === 0 ? ["  None"] : []),
    "",
    "SOUNDCHARTS SUBGENRES",
    ...audit.subgenres.map(({ value, count }) => `  ${value}: ${count}`),
    ...(audit.subgenres.length === 0 ? ["  None"] : []),
    "",
    "POTENTIAL GENRE MISMATCHES (RANKED TRACKS)",
    "These are conservative review candidates, not confirmed errors or automatic mappings.",
    ...audit.potentialMismatches.map((example) => (
      `  - ${example.title} - ${example.artistNames}: local [${example.localGenres.join(", ") || "none"}]; Soundcharts [${example.soundchartsRootGenres.join(", ")}]`
    )),
    ...(audit.potentialMismatches.length === 0 ? ["  None"] : []),
    "",
    "No tracks or TrackCategory rows were modified. No network requests were made.",
  ].join("\n");
}
