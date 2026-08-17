import { describe, expect, it } from "vitest";
import { deriveDecadeCategoryId } from "@/lib/catalog/derived-categories";

describe("derived decade categories", () => {
  it.each([
    ["1970", "70s"],
    ["1979", "70s"],
    ["1980", "80s"],
    ["1989", "80s"],
    ["1990", "90s"],
    ["1999", "90s"],
    ["2000", "2000s"],
    ["2009", "2000s"],
    ["2010", "2010s"],
    ["2019", "2010s"],
    ["2020", "2020s"],
    ["2029", "2020s"],
    ["1984-06", "80s"],
    ["2021-12-31", "2020s"],
  ] as const)("derives %s as %s", (releaseDate, categoryId) => {
    expect(deriveDecadeCategoryId(releaseDate)).toBe(categoryId);
  });

  it.each([
    null,
    undefined,
    "",
    "unknown",
    "1969",
    "2030",
    "2020/01/01",
    "2020-00",
    "2020-13",
    "2020-02-30",
  ])("does not derive a category from %s", (releaseDate) => {
    expect(deriveDecadeCategoryId(releaseDate)).toBeNull();
  });
});
