import { describe, expect, it } from "vitest";
import {
  activeCatalogStatusCategories,
  formatCatalogStatus,
  type CatalogStatusData,
} from "@/lib/catalog/catalog-status-report";

describe("catalog status report", () => {
  it("shows only active genre and decade pools", () => {
    const categories = activeCatalogStatusCategories();
    expect(categories.map((category) => category.id)).toEqual([
      "pop", "rock", "hip-hop", "r-and-b", "electronic", "classical",
      "70s", "80s", "90s", "2000s", "2010s", "2020s",
    ]);
    expect(categories.map((category) => category.id)).not.toEqual(expect.arrayContaining([
      "indie", "metal", "punk", "country", "jazz",
    ]));

    const data: CatalogStatusData = {
      totalTracks: 100,
      playableTracks: 90,
      gameEligibleTracks: 88,
      gameIneligibleTracks: 12,
      rankedTracks: 40,
      gameplayRankedTracks: 35,
      unrankedTracks: 60,
      difficulty: { easy: 10, normal: 10, hard: 10, extreme: 5, impossible: 5 },
      allMusic: { total: 90, ranked: 35 },
      pools: categories.map((category) => ({ ...category, total: 20, ranked: 8, gameplayRanked: 7 })),
    };
    const report = formatCatalogStatus(data);
    expect(report).toContain("CATALOG STATUS");
    expect(report).toContain("All Music");
    expect(report).toContain("Electronic / Dance");
    expect(report).toContain("2020s");
    expect(report).toContain("Game-eligible tracks: 88");
    expect(report).toContain("Game-ineligible tracks: 12");
    expect(report).toContain("Ranked tracks (raw): 40");
    expect(report).toContain("Game-eligible ranked tracks (playable): 35");
    expect(report).toContain("GAMEPLAY-ENABLED RANKED CATEGORY COVERAGE");
    expect(report).toContain("R&B / Soul: 7");
    expect(report).not.toMatch(/Indie|Metal|Punk|Country|Jazz/);
  });
});
