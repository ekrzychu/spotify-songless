import { CATEGORIES } from "@/lib/catalog/category-config";
import { DIFFICULTY_LABELS } from "@/lib/game/difficulty";
import { DIFFICULTIES, type Difficulty } from "@/types/game";

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
  language: {
    eligible: number;
    ineligible: number;
    unknown: number;
    eligibleRanked: number;
    byCode: Record<string, number>;
  };
  difficulty: Record<Difficulty, number>;
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
    `Ranked tracks (raw): ${data.rankedTracks}`,
    `Game-eligible ranked tracks (playable): ${data.gameplayRankedTracks}`,
    `Unranked tracks: ${data.unrankedTracks}`,
    "",
    "LANGUAGE ELIGIBILITY",
    `Eligible EN/PL/ES: ${data.language.eligible}`,
    `Ineligible: ${data.language.ineligible}`,
    `Unknown/uncertain: ${data.language.unknown}`,
    `Eligible ranked and playable: ${data.language.eligibleRanked}`,
    `English (en): ${data.language.byCode.en ?? 0}`,
    `Polish (pl): ${data.language.byCode.pl ?? 0}`,
    `Spanish (es): ${data.language.byCode.es ?? 0}`,
    `Other: ${otherLanguages}`,
    "",
    "DIFFICULTY",
    ...DIFFICULTIES.map((difficulty) => `${DIFFICULTY_LABELS[difficulty]}: ${data.difficulty[difficulty]}`),
    `Unranked: ${data.unrankedTracks}`,
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
