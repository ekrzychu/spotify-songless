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
  { id: "indie", label: "Indie / Alternative", type: "genre", spotifyQuery: "genre:indie" },
  { id: "metal", label: "Metal", type: "genre", spotifyQuery: "genre:metal" },
  { id: "punk", label: "Punk", type: "genre", spotifyQuery: "genre:punk" },
  { id: "country", label: "Country", type: "genre", spotifyQuery: "genre:country" },
  { id: "jazz", label: "Jazz", type: "genre", spotifyQuery: "genre:jazz" },
  { id: "classical", label: "Classical", type: "genre", spotifyQuery: "genre:classical" },
];

const decadeCategories: CategoryDefinition[] = [
  { id: "70s", label: "70s", type: "decade", spotifyQuery: "year:1970-1979" },
  { id: "80s", label: "80s", type: "decade", spotifyQuery: "year:1980-1989" },
  { id: "90s", label: "90s", type: "decade", spotifyQuery: "year:1990-1999" },
  { id: "2000s", label: "2000s", type: "decade", spotifyQuery: "year:2000-2009" },
  { id: "2010s", label: "2010s", type: "decade", spotifyQuery: "year:2010-2019" },
  { id: "2020s", label: "2020s", type: "decade", spotifyQuery: "year:2020-2029" },
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
