import { describe, expect, it } from "vitest";
import {
  groupEnrichmentCandidates,
  selectBalancedEnrichmentGroups,
  type EnrichmentTrackCandidate,
} from "@/lib/streams/enrichment-selection";

function track(
  id: string,
  categoryId: string,
  overrides: Partial<EnrichmentTrackCandidate> = {},
): EnrichmentTrackCandidate {
  return {
    id,
    spotifyTrackId: id.padEnd(22, "0").slice(0, 22),
    isrc: null,
    title: `Track ${id}`,
    artistNames: `Artist ${id}`,
    streamCount: null,
    streamCountSource: null,
    soundchartsUuid: null,
    categories: [{ categoryId }],
    ...overrides,
  };
}

describe("Soundcharts enrichment selection", () => {
  it("groups normalized ISRC variants without grouping by title or artist", () => {
    const groups = groupEnrichmentCandidates([
      track("a", "pop", { isrc: "US-ABC-12-34567" }),
      track("b", "rock", { isrc: "usabc1234567" }),
      track("c", "pop", { title: "Track a", artistNames: "Artist a" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.normalizedIsrc === "USABC1234567")?.targetTrackIds).toHaveLength(2);
  });

  it("skips enriched tracks by default and refreshes only Soundcharts-owned values explicitly", () => {
    const candidates = [
      track("missing", "pop"),
      track("soundcharts", "rock", { streamCount: 100n, streamCountSource: "soundcharts" }),
      track("csv", "jazz", { streamCount: 100n, streamCountSource: "csv" }),
    ];

    expect(groupEnrichmentCandidates(candidates).map((group) => group.representative.id)).toEqual(["missing"]);
    expect(groupEnrichmentCandidates(candidates, true).map((group) => group.representative.id).sort()).toEqual([
      "missing",
      "soundcharts",
    ]);
  });

  it("selects a repeatable category-balanced batch independent of input order", () => {
    const categories = [
      "pop", "rock", "hip-hop", "r-and-b", "electronic", "indie",
      "metal", "punk", "country", "jazz", "classical",
      "70s", "80s", "90s", "2000s", "2010s", "2020s",
    ];
    const candidates = categories.flatMap((category, index) => [
      track(`${category}-a-${index}`, category),
      track(`${category}-b-${index}`, category),
    ]);
    const first = selectBalancedEnrichmentGroups(candidates, 17);
    const second = selectBalancedEnrichmentGroups([...candidates].reverse(), 17);

    expect(new Set(first.flatMap((group) => group.categoryIds))).toEqual(new Set(categories));
    expect(first.map((group) => group.key)).toEqual(second.map((group) => group.key));
  });
});
