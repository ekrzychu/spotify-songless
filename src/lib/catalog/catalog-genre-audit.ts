import { CATEGORIES } from "@/lib/catalog/category-config";
import {
  classifyTrackQuality,
  TRACK_QUALITY_REASONS,
  type TrackQualityReason,
} from "@/lib/catalog/track-quality";

export const ACTIVE_AUDIT_GENRES = CATEGORIES
  .filter((category) => category.type === "genre")
  .map(({ id, label }) => ({ id, label }));

export type CatalogGenreAuditTrack = {
  id: string;
  spotifyTrackId: string;
  title: string;
  artistNames: string;
  categories: ReadonlyArray<{ categoryId: string }>;
};

export type CatalogAuditSample = {
  title: string;
  artistNames: string;
};

export type CatalogGenreAudit = {
  totalTracks: number;
  multiActiveGenreTracks: number;
  overlaps: Record<string, Record<string, number>>;
  classicalOverlaps: Array<{
    genreId: string;
    genreLabel: string;
    count: number;
    samples: CatalogAuditSample[];
  }>;
  quality: {
    obviousNonSonglikeTracks: number;
    byReason: Record<TrackQualityReason, number>;
    samples: Array<CatalogAuditSample & { reason: TrackQualityReason }>;
  };
};

export type CatalogGenreAuditDependencies = {
  readTracks: () => Promise<CatalogGenreAuditTrack[]>;
};

export function buildCatalogGenreAudit(
  tracks: readonly CatalogGenreAuditTrack[],
  sampleLimit = 20,
): CatalogGenreAudit {
  const activeIds = new Set(ACTIVE_AUDIT_GENRES.map((genre) => genre.id));
  const orderedTracks = [...tracks].sort((left, right) => (
    left.spotifyTrackId.localeCompare(right.spotifyTrackId)
    || left.id.localeCompare(right.id)
  ));
  const overlaps = Object.fromEntries(ACTIVE_AUDIT_GENRES.map((left) => [
    left.id,
    Object.fromEntries(ACTIVE_AUDIT_GENRES.map((right) => [right.id, 0])),
  ]));
  const classicalTracksByGenre = new Map<string, CatalogGenreAuditTrack[]>();
  const qualityByReason = Object.fromEntries(
    TRACK_QUALITY_REASONS.map((reason) => [reason, 0]),
  ) as Record<TrackQualityReason, number>;
  const qualitySamples: Array<CatalogAuditSample & { reason: TrackQualityReason }> = [];
  let multiActiveGenreTracks = 0;
  let obviousNonSonglikeTracks = 0;

  for (const track of orderedTracks) {
    const genreIds = ACTIVE_AUDIT_GENRES
      .map((genre) => genre.id)
      .filter((id) => activeIds.has(id) && track.categories.some((category) => category.categoryId === id));
    if (genreIds.length > 1) multiActiveGenreTracks += 1;
    for (let leftIndex = 0; leftIndex < genreIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < genreIds.length; rightIndex += 1) {
        const left = genreIds[leftIndex]!;
        const right = genreIds[rightIndex]!;
        overlaps[left]![right] = (overlaps[left]![right] ?? 0) + 1;
        overlaps[right]![left] = (overlaps[right]![left] ?? 0) + 1;
      }
    }
    if (genreIds.includes("classical")) {
      for (const genreId of genreIds.filter((id) => id !== "classical")) {
        const list = classicalTracksByGenre.get(genreId) ?? [];
        list.push(track);
        classicalTracksByGenre.set(genreId, list);
      }
    }

    const quality = classifyTrackQuality(track.title);
    if (!quality.eligible) {
      obviousNonSonglikeTracks += 1;
      qualityByReason[quality.reason] += 1;
      if (qualitySamples.length < sampleLimit) {
        qualitySamples.push({ title: track.title, artistNames: track.artistNames, reason: quality.reason });
      }
    }
  }

  const nonClassicalGenres = ACTIVE_AUDIT_GENRES.filter((genre) => genre.id !== "classical");
  const samplesPerClassicalCombination = nonClassicalGenres.length === 0
    ? 0
    : Math.max(1, Math.floor(sampleLimit / nonClassicalGenres.length));
  const classicalOverlaps = nonClassicalGenres.map((genre) => {
    const matching = classicalTracksByGenre.get(genre.id) ?? [];
    return {
      genreId: genre.id,
      genreLabel: genre.label,
      count: matching.length,
      samples: matching.slice(0, samplesPerClassicalCombination).map(({ title, artistNames }) => ({
        title,
        artistNames,
      })),
    };
  });

  return {
    totalTracks: tracks.length,
    multiActiveGenreTracks,
    overlaps,
    classicalOverlaps,
    quality: {
      obviousNonSonglikeTracks,
      byReason: qualityByReason,
      samples: qualitySamples,
    },
  };
}

export async function executeCatalogGenreAudit(
  dependencies: CatalogGenreAuditDependencies,
): Promise<CatalogGenreAudit> {
  return buildCatalogGenreAudit(await dependencies.readTracks());
}

export function formatCatalogGenreAudit(audit: CatalogGenreAudit): string {
  const labelWidth = 22;
  const cellWidth = Math.max(12, ...ACTIVE_AUDIT_GENRES.map((genre) => genre.label.length + 2));
  const matrixHeader = `${"".padEnd(labelWidth)}${ACTIVE_AUDIT_GENRES
    .map((genre) => genre.label.padStart(cellWidth)).join("")}`;
  const matrixRows = ACTIVE_AUDIT_GENRES.map((left) => (
    `${left.label.padEnd(labelWidth)}${ACTIVE_AUDIT_GENRES.map((right) => (
      left.id === right.id ? "-" : String(audit.overlaps[left.id]?.[right.id] ?? 0)
    )).map((value) => value.padStart(cellWidth)).join("")}`
  ));
  return [
    "CATALOG GENRE ASSOCIATION AUDIT",
    "",
    "This report describes overlaps and potentially suspicious associations; it does not declare them incorrect.",
    "Category relations do not store Spotify search-shard provenance, so this database cannot identify which search created a historical association.",
    "",
    "ACTIVE GENRE OVERLAPS",
    `Tracks with multiple active genre relations: ${audit.multiActiveGenreTracks}`,
    matrixHeader,
    ...matrixRows,
    "",
    "CLASSICAL + OTHER ACTIVE GENRE",
    ...audit.classicalOverlaps.flatMap((overlap) => [
      `Classical + ${overlap.genreLabel}: ${overlap.count}`,
      ...overlap.samples.map((sample) => `  - ${sample.title} - ${sample.artistNames}`),
    ]),
    "",
    "TRACK QUALITY AUDIT",
    `Total catalog tracks: ${audit.totalTracks}`,
    `Obvious non-song-like tracks: ${audit.quality.obviousNonSonglikeTracks}`,
    "",
    "By reason:",
    ...TRACK_QUALITY_REASONS.map((reason) => `  ${reason}: ${audit.quality.byReason[reason]}`),
    "",
    "Sample obvious non-song-like tracks:",
    ...audit.quality.samples.map((sample) => (
      `  - [${sample.reason}] ${sample.title} - ${sample.artistNames}`
    )),
    ...(audit.quality.samples.length === 0 ? ["  None"] : []),
    "",
    "No tracks or category relations were modified.",
  ].join("\n");
}
