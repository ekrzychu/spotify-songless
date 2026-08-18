import { CATEGORY_IDS } from "@/lib/catalog/category-config";
import { GAME_DIFFICULTIES, type GameDifficulty } from "@/types/game";

export type GameFilters = { category: string; difficulty: GameDifficulty };

export const DEFAULT_FILTERS: GameFilters = { category: "all", difficulty: "normal" };

export function normalizeStoredFilters(value: unknown): GameFilters {
  if (!value || typeof value !== "object") return DEFAULT_FILTERS;
  const candidate = value as { category?: unknown; difficulty?: unknown };
  const category = typeof candidate.category === "string" && CATEGORY_IDS.includes(candidate.category)
    ? candidate.category
    : DEFAULT_FILTERS.category;
  const difficulty = typeof candidate.difficulty === "string"
    && GAME_DIFFICULTIES.includes(candidate.difficulty as GameDifficulty)
    ? candidate.difficulty as GameDifficulty
    : DEFAULT_FILTERS.difficulty;
  return { category, difficulty };
}
