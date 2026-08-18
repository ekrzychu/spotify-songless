import { CATEGORIES } from "@/lib/catalog/category-config";
import {
  mapSoundchartsGenresToActiveCategories,
  type MappedActiveGenreId,
} from "@/lib/catalog/soundcharts-genre-mapping";
import type { SoundchartsSongGenre } from "@/lib/soundcharts/client";

export const ACTIVE_GAME_GENRES = CATEGORIES
  .filter((category): category is typeof category & { type: "genre" } => category.type === "genre")
  .map(({ id, label }) => ({ id: id as MappedActiveGenreId, label }));

const ACTIVE_GAME_GENRE_IDS = new Set<string>(ACTIVE_GAME_GENRES.map((genre) => genre.id));

export type CategoryGameplayRelation = {
  trackId: string;
  categoryId: string;
  gameEligible: boolean;
  gameEligibilitySource: string | null;
};

export type CategoryGameplayValidationTrack = {
  id: string;
  title: string;
  artistNames: string;
  soundchartsGenres: readonly SoundchartsSongGenre[];
  categories: readonly CategoryGameplayRelation[];
};

export type CategoryGameplayDecision = {
  trackId: string;
  categoryId: MappedActiveGenreId;
  outcome: "confirmed" | "rejected" | "insufficient-evidence";
  desiredGameEligible: boolean | null;
  needsUpdate: boolean;
};

export type CategoryGameplayValidationSummary = {
  metadataBearingTracks: number;
  tracksWithMappedActiveGenres: number;
  genreRelationsInspected: number;
  confirmedRelations: number;
  rejectedRelations: number;
  unchangedInsufficientEvidence: number;
  rowsUpdated: number;
  byGenre: Record<MappedActiveGenreId, {
    inspected: number;
    confirmed: number;
    rejected: number;
    insufficientEvidence: number;
  }>;
  rejectedExamples: Array<{
    title: string;
    artistNames: string;
    rejectedGenreId: MappedActiveGenreId;
    mappedGenreIds: MappedActiveGenreId[];
  }>;
};

export type CategoryGameplayValidationDependencies = {
  updateRelation: (
    trackId: string,
    categoryId: MappedActiveGenreId,
    data: {
      gameEligible: boolean;
      gameEligibilitySource: "soundcharts";
      gameEligibilityUpdatedAt: Date;
    },
  ) => Promise<void>;
};

export function evaluateSoundchartsCategoryRelations(
  categories: readonly CategoryGameplayRelation[],
  soundchartsGenres: readonly SoundchartsSongGenre[],
): { mappedGenreIds: MappedActiveGenreId[]; decisions: CategoryGameplayDecision[] } {
  const mappedGenreIds = mapSoundchartsGenresToActiveCategories(soundchartsGenres);
  const mapped = new Set<string>(mappedGenreIds);
  const decisions = categories.flatMap((relation): CategoryGameplayDecision[] => {
    if (!ACTIVE_GAME_GENRE_IDS.has(relation.categoryId)) return [];
    const categoryId = relation.categoryId as MappedActiveGenreId;
    if (mapped.size === 0) {
      return [{
        trackId: relation.trackId,
        categoryId,
        outcome: "insufficient-evidence",
        desiredGameEligible: null,
        needsUpdate: false,
      }];
    }
    const desiredGameEligible = mapped.has(categoryId);
    return [{
      trackId: relation.trackId,
      categoryId,
      outcome: desiredGameEligible ? "confirmed" : "rejected",
      desiredGameEligible,
      needsUpdate: relation.gameEligible !== desiredGameEligible
        || relation.gameEligibilitySource !== "soundcharts",
    }];
  });
  return { mappedGenreIds, decisions };
}

export async function validateCategoryGameplayEligibility(
  tracks: readonly CategoryGameplayValidationTrack[],
  dependencies: CategoryGameplayValidationDependencies,
  options: { now?: Date; exampleLimit?: number } = {},
): Promise<CategoryGameplayValidationSummary> {
  const now = options.now ?? new Date();
  const exampleLimit = options.exampleLimit ?? 20;
  const byGenre = Object.fromEntries(ACTIVE_GAME_GENRES.map((genre) => [genre.id, {
    inspected: 0,
    confirmed: 0,
    rejected: 0,
    insufficientEvidence: 0,
  }])) as CategoryGameplayValidationSummary["byGenre"];
  const rejectedExamples: CategoryGameplayValidationSummary["rejectedExamples"] = [];
  let tracksWithMappedActiveGenres = 0;
  let genreRelationsInspected = 0;
  let confirmedRelations = 0;
  let rejectedRelations = 0;
  let unchangedInsufficientEvidence = 0;
  let rowsUpdated = 0;

  for (const track of tracks) {
    const evaluation = evaluateSoundchartsCategoryRelations(track.categories, track.soundchartsGenres);
    if (evaluation.mappedGenreIds.length > 0) tracksWithMappedActiveGenres += 1;
    for (const decision of evaluation.decisions) {
      genreRelationsInspected += 1;
      const genreSummary = byGenre[decision.categoryId];
      genreSummary.inspected += 1;
      if (decision.outcome === "confirmed") {
        confirmedRelations += 1;
        genreSummary.confirmed += 1;
      } else if (decision.outcome === "rejected") {
        rejectedRelations += 1;
        genreSummary.rejected += 1;
        if (rejectedExamples.length < exampleLimit) {
          rejectedExamples.push({
            title: track.title,
            artistNames: track.artistNames,
            rejectedGenreId: decision.categoryId,
            mappedGenreIds: evaluation.mappedGenreIds,
          });
        }
      } else {
        unchangedInsufficientEvidence += 1;
        genreSummary.insufficientEvidence += 1;
      }
      if (decision.needsUpdate && decision.desiredGameEligible !== null) {
        await dependencies.updateRelation(decision.trackId, decision.categoryId, {
          gameEligible: decision.desiredGameEligible,
          gameEligibilitySource: "soundcharts",
          gameEligibilityUpdatedAt: now,
        });
        rowsUpdated += 1;
      }
    }
  }

  return {
    metadataBearingTracks: tracks.length,
    tracksWithMappedActiveGenres,
    genreRelationsInspected,
    confirmedRelations,
    rejectedRelations,
    unchangedInsufficientEvidence,
    rowsUpdated,
    byGenre,
    rejectedExamples,
  };
}

export function formatCategoryGameplayValidation(summary: CategoryGameplayValidationSummary): string {
  return [
    "CATEGORY GAMEPLAY VALIDATION",
    "",
    `Metadata-bearing tracks: ${summary.metadataBearingTracks}`,
    `Tracks with mapped active Soundcharts genres: ${summary.tracksWithMappedActiveGenres}`,
    `Genre relations inspected: ${summary.genreRelationsInspected}`,
    `Confirmed relations: ${summary.confirmedRelations}`,
    `Rejected relations: ${summary.rejectedRelations}`,
    `Unchanged due to insufficient mapped evidence: ${summary.unchangedInsufficientEvidence}`,
    `Rows updated: ${summary.rowsUpdated}`,
    "",
    "BY GENRE",
    ...ACTIVE_GAME_GENRES.map((genre) => {
      const value = summary.byGenre[genre.id];
      return `${genre.label}: inspected=${value.inspected}, confirmed=${value.confirmed}, rejected=${value.rejected}, insufficient=${value.insufficientEvidence}`;
    }),
    "",
    "REJECTED EXAMPLES",
    ...summary.rejectedExamples.map((example) => (
      `  - ${example.title} - ${example.artistNames}: rejected ${example.rejectedGenreId}; mapped [${example.mappedGenreIds.join(", ")}]`
    )),
    ...(summary.rejectedExamples.length === 0 ? ["  None"] : []),
    "",
    "Raw TrackCategory rows and decade relations were preserved.",
  ].join("\n");
}
