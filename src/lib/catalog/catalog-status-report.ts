import { CATEGORIES } from "@/lib/catalog/category-config";
import { RANKED_DIFFICULTY_LABELS } from "@/lib/game/difficulty";
import { RANKED_DIFFICULTIES, type RankedDifficulty } from "@/types/game";

export type CatalogPoolStatus = {
  id: string;
  label: string;
  type: "genre" | "decade";
  total: number;
  ranked: number;
  gameplayRanked: number;
};

export type CatalogStatusData = {
  totalTracks: number;
  playableTracks: number;
  gameEligibleTracks: number;
  gameIneligibleTracks: number;
  rankedTracks: number;
  gameplayRankedTracks: number;
  unrankedTracks: number;
  gameplayUnrankedTracks: number;
  language: {
    accepted: number;
    classifiedAllowed: number;
    unclassifiedAccepted: number;
    rejectedClassified: number;
    acceptedRanked: number;
    byCode: Record<string, number>;
  };
  difficulty: Record<RankedDifficulty, number>;
  allMusic: { total: number; ranked: number };
  pools: CatalogPoolStatus[];
};

export function activeCatalogStatusCategories(): Array<{
  id: string;
  label: string;
  type: "genre" | "decade";
}> {
  return CATEGORIES
    .filter((category): category is typeof category & { type: "genre" | "decade" } => (
      category.type === "genre" || category.type === "decade"
    ))
    .map(({ id, label, type }) => ({ id, label, type }));
}

export function formatCatalogStatus(data: CatalogStatusData): string {
  const genres = data.pools.filter((pool) => pool.type === "genre");
  const decades = data.pools.filter((pool) => pool.type === "decade");
  const otherLanguages = Object.entries(data.language.byCode)
    .filter(([code]) => !["en", "pl", "es", "unknown"].includes(code))
    .reduce((total, [, count]) => total + count, 0);
  return [
    "CATALOG STATUS",
    "",
    `Total tracks: ${data.totalTracks}`,
    `Playable tracks: ${data.playableTracks}`,
    `Game-eligible tracks: ${data.gameEligibleTracks}`,
    `Game-ineligible tracks: ${data.gameIneligibleTracks}`,
    "",
    "RANKING STATUS",
    `Ranked tracks (raw): ${data.rankedTracks}`,
    `Game-eligible ranked tracks (playable): ${data.gameplayRankedTracks}`,
    `Unranked tracks (raw): ${data.unrankedTracks}`,
    `Game-eligible Unranked tracks (playable): ${data.gameplayUnrankedTracks}`,
    "",
    "LANGUAGE POLICY",
    `Accepted tracks: ${data.language.accepted}`,
    `  Classified EN/PL/ES: ${data.language.classifiedAllowed}`,
    `  Unclassified/unknown/uncertain: ${data.language.unclassifiedAccepted}`,
    `Rejected classified other languages: ${data.language.rejectedClassified}`,
    `Accepted ranked and playable: ${data.language.acceptedRanked}`,
    `English (en): ${data.language.byCode.en ?? 0}`,
    `Polish (pl): ${data.language.byCode.pl ?? 0}`,
    `Spanish (es): ${data.language.byCode.es ?? 0}`,
    `Other classified: ${otherLanguages}`,
    `Unknown/uncertain: ${data.language.byCode.unknown ?? 0}`,
    "",
    "DIFFICULTY",
    ...RANKED_DIFFICULTIES.map((difficulty) => `${RANKED_DIFFICULTY_LABELS[difficulty]}: ${data.difficulty[difficulty]}`),
    `Unranked (raw): ${data.unrankedTracks}`,
    `Unranked (gameplay): ${data.gameplayUnrankedTracks}`,
    "",
    "ALL MUSIC (playable)",
    formatPool("All Music", data.allMusic.total, data.allMusic.ranked),
    "",
    "GENRES (playable)",
    ...genres.map((pool) => formatPool(pool.label, pool.total, pool.ranked)),
    "",
    "DECADES (playable)",
    ...decades.map((pool) => formatPool(pool.label, pool.total, pool.ranked)),
    "",
    "GAMEPLAY-ENABLED RANKED CATEGORY COVERAGE",
    `All Music: ${data.gameplayRankedTracks}`,
    "",
    "GENRES",
    ...genres.map((pool) => `${pool.label}: ${pool.gameplayRanked}`),
    "",
    "DECADES",
    ...decades.map((pool) => `${pool.label}: ${pool.gameplayRanked}`),
  ].join("\n");
}

function formatPool(label: string, total: number, ranked: number): string {
  return `${label.padEnd(20)} ${String(total).padStart(7)} total / ${String(ranked).padStart(7)} ranked`;
}
