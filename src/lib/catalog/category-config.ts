export type CategoryDefinition = {
  id: string;
  label: string;
  type: "genre" | "decade" | "custom";
  spotifyQuery?: string;
};

const genreCategories: CategoryDefinition[] = [
  { id: "pop", label: "Pop", type: "genre", spotifyQuery: "genre:pop" },
  { id: "rock", label: "Rock", type: "genre", spotifyQuery: "genre:rock" },
  { id: "hip-hop", label: "Hip-Hop / Rap", type: "genre", spotifyQuery: "genre:hip-hop" },
  { id: "r-and-b", label: "R&B / Soul", type: "genre", spotifyQuery: "genre:r-n-b" },
  { id: "electronic", label: "Electronic / Dance", type: "genre", spotifyQuery: "genre:electronic" },
  { id: "classical", label: "Classical", type: "genre", spotifyQuery: "genre:classical" },
];

const decadeCategories: CategoryDefinition[] = [
  { id: "70s", label: "70s", type: "decade" },
  { id: "80s", label: "80s", type: "decade" },
  { id: "90s", label: "90s", type: "decade" },
  { id: "2000s", label: "2000s", type: "decade" },
  { id: "2010s", label: "2010s", type: "decade" },
  { id: "2020s", label: "2020s", type: "decade" },
];

export const CATEGORY_GROUPS: { label: string; categories: CategoryDefinition[] }[] = [
  { label: "General", categories: [{ id: "all", label: "All Music", type: "custom" }] },
  { label: "Genres", categories: genreCategories },
  { label: "Decades", categories: decadeCategories },
];

export const CATEGORIES: CategoryDefinition[] = CATEGORY_GROUPS.flatMap((group) => group.categories);
export const CATEGORY_IDS = CATEGORIES.map((category) => category.id);

export function getCategory(id: string): CategoryDefinition | undefined {
  return CATEGORIES.find((category) => category.id === id);
}
