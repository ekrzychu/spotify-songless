import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_IDS } from "@/lib/catalog/category-config";
import { ENRICHMENT_BALANCE_CATEGORY_IDS } from "@/lib/streams/enrichment-selection";

const REMOVED_CATEGORY_IDS = ["indie", "metal", "punk", "country", "jazz"];
const ACTIVE_GENRE_IDS = ["pop", "rock", "hip-hop", "r-and-b", "electronic", "classical"];
const DECADE_IDS = ["70s", "80s", "90s", "2000s", "2010s", "2020s"];

describe("active category configuration", () => {
  it("removes exactly the five retired genre IDs from selectable and validated categories", () => {
    expect(CATEGORY_IDS).not.toEqual(expect.arrayContaining(REMOVED_CATEGORY_IDS));
    expect(CATEGORY_IDS).toEqual(expect.arrayContaining(["all", ...ACTIVE_GENRE_IDS, ...DECADE_IDS]));
  });

  it("limits future explicit Spotify genre searches to the six active genres", () => {
    expect(CATEGORIES.filter((category) => category.type === "genre").map((category) => category.id)).toEqual(ACTIVE_GENRE_IDS);
    expect(CATEGORIES.filter((category) => category.spotifyQuery).map((category) => category.spotifyQuery)).toEqual([
      "genre:pop", "genre:rock", "genre:hip-hop", "genre:r-n-b", "genre:electronic", "genre:classical",
    ]);
  });

  it("removes retired genres from Soundcharts balancing while retaining decades", () => {
    expect(ENRICHMENT_BALANCE_CATEGORY_IDS).not.toEqual(expect.arrayContaining(REMOVED_CATEGORY_IDS));
    expect(ENRICHMENT_BALANCE_CATEGORY_IDS).toEqual(expect.arrayContaining([...ACTIVE_GENRE_IDS, ...DECADE_IDS]));
  });
});
