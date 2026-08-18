import { describe, expect, it, vi } from "vitest";
import {
  ACTIVE_ENRICHMENT_CATEGORIES,
  buildRankedCoverageMatrix,
  buildSoundchartsEnrichmentPlan,
  executeSoundchartsEnrichmentPlanning,
  groupEnrichmentCandidates,
  parseSoundchartsExecutionOptions,
  parseSoundchartsPlanningOptions,
  type EnrichmentTrackCandidate,
  type SoundchartsSelectionOptions,
} from "@/lib/streams/enrichment-selection";
import { DIFFICULTIES, type Difficulty } from "@/types/game";

function track(
  id: string,
  categoryIds: string | string[],
  overrides: Partial<EnrichmentTrackCandidate> = {},
): EnrichmentTrackCandidate {
  const categories = Array.isArray(categoryIds) ? categoryIds : [categoryIds];
  return {
    id,
    spotifyTrackId: id.padEnd(22, "0").slice(0, 22),
    isrc: null,
    title: `Track ${id}`,
    artistNames: `Artist ${id}`,
    streamCount: null,
    streamCountSource: null,
    soundchartsUuid: null,
    difficulty: null,
    categories: categories.map((categoryId) => ({ categoryId })),
    ...overrides,
  };
}

const options: SoundchartsSelectionOptions = {
  limit: 100,
  targetPerCell: 10,
  includeCachedUnranked: false,
  refresh: false,
};

function ranked(id: string, categoryIds: string[], difficulty: Difficulty): EnrichmentTrackCandidate {
  return track(id, categoryIds, {
    streamCount: 1n,
    streamCountSource: "soundcharts",
    difficulty,
  });
}

describe("Soundcharts recording groups", () => {
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
      ranked("soundcharts", ["rock"], "hard"),
      track("csv", "jazz", { streamCount: 100n, streamCountSource: "csv", difficulty: "hard" }),
    ];

    expect(groupEnrichmentCandidates(candidates).map((group) => group.representative.id)).toEqual(["missing"]);
    expect(groupEnrichmentCandidates(candidates, true).map((group) => group.representative.id).sort()).toEqual([
      "missing",
      "soundcharts",
    ]);
  });
});

describe("adaptive Soundcharts planning", () => {
  it("builds the active genre and decade difficulty matrix from ranked tracks", () => {
    const coverage = buildRankedCoverageMatrix([
      ranked("pop-easy", ["pop", "80s"], "easy"),
      ranked("hip-hard", ["hip-hop", "90s", "jazz"], "hard"),
      track("unranked", ["pop", "2010s"]),
    ]);

    expect(ACTIVE_ENRICHMENT_CATEGORIES.map((category) => category.id)).toEqual([
      "pop", "rock", "hip-hop", "r-and-b", "electronic", "classical",
      "70s", "80s", "90s", "2000s", "2010s", "2020s",
    ]);
    expect(coverage.allMusic).toMatchObject({ easy: 1, hard: 1 });
    expect(coverage.categories.pop?.easy).toBe(1);
    expect(coverage.categories["80s"]?.easy).toBe(1);
    expect(coverage.categories["hip-hop"]?.hard).toBe(1);
    expect(coverage.categories["90s"]?.hard).toBe(1);
    expect(coverage.categories).not.toHaveProperty("jazz");
  });

  it("prioritizes candidates serving thinner genre and decade cells", () => {
    const fullCategories = DIFFICULTIES.map((difficulty) => (
      ranked(`full-${difficulty}`, ["pop", "2010s"], difficulty)
    ));
    const candidateA = track("candidate-a", ["pop", "2010s"]);
    const candidateB = track("candidate-b", ["hip-hop", "80s"]);
    const plan = buildSoundchartsEnrichmentPlan([...fullCategories, candidateA, candidateB], {
      ...options,
      targetPerCell: 1,
    });

    expect(plan.selectedGroups[0]?.representative.id).toBe("candidate-b");
    expect(plan.selectedGroups[0]?.needScore).toBeGreaterThan(plan.selectedGroups[1]?.needScore ?? 0);
  });

  it("keeps unranked candidate difficulty explicitly unknown", () => {
    const plan = buildSoundchartsEnrichmentPlan([track("candidate", ["rock", "70s"])], options);
    expect(plan.selectedGroups[0]?.difficulty).toBe("unknown");
  });

  it("is deterministic regardless of input ordering", () => {
    const candidates = [
      track("a", ["pop", "80s"], { isrc: "USAAA1234567" }),
      track("b", ["rock", "90s"], { isrc: "USBBB1234567" }),
      track("c", ["hip-hop", "2000s"]),
    ];
    const first = buildSoundchartsEnrichmentPlan(candidates, options);
    const second = buildSoundchartsEnrichmentPlan([...candidates].reverse(), options);
    expect(first.selectedGroups.map((group) => group.key)).toEqual(second.selectedGroups.map((group) => group.key));
  });

  it("excludes cached unranked groups by default and includes them explicitly", () => {
    const fresh = track("fresh", ["pop", "80s"]);
    const cached = track("cached", ["hip-hop", "90s"], { soundchartsUuid: "cached-uuid" });
    const defaultPlan = buildSoundchartsEnrichmentPlan([fresh, cached], options);
    const includedPlan = buildSoundchartsEnrichmentPlan([fresh, cached], {
      ...options,
      includeCachedUnranked: true,
    });

    expect(defaultPlan.cachedUnrankedGroups).toBe(1);
    expect(defaultPlan.selectedGroups.map((group) => group.representative.id)).toEqual(["fresh"]);
    expect(includedPlan.selectedGroups.map((group) => group.representative.id)).toContain("cached");
  });

  it("uses one shared selector for plan and execution-equivalent options", () => {
    const candidates = [track("a", ["pop", "80s"]), track("b", ["rock", "90s"])];
    const planningOptions = parseSoundchartsPlanningOptions([
      "--limit=1", "--target-per-cell=7", "--include-cached-unranked",
    ]);
    const executionOptions = parseSoundchartsExecutionOptions([
      "--limit=1", "--target-per-cell=7", "--include-cached-unranked", "--max-api-requests=3",
    ]);
    const planning = buildSoundchartsEnrichmentPlan(candidates, planningOptions);
    const execution = buildSoundchartsEnrichmentPlan(candidates, executionOptions);
    expect(planning.selectedGroups.map((group) => group.key))
      .toEqual(execution.selectedGroups.map((group) => group.key));
  });

  it("allows large zero-network plans while validating planning controls", () => {
    expect(parseSoundchartsPlanningOptions([
      "--limit=500", "--target-per-cell=12", "--include-cached-unranked", "--verbose",
    ])).toMatchObject({
      limit: 500,
      targetPerCell: 12,
      includeCachedUnranked: true,
      refresh: false,
      verbose: true,
    });
    expect(() => parseSoundchartsPlanningOptions(["--limit=0"])).toThrow("--limit");
  });

  it("has a read-only planning boundary with zero token, customer, network, or write calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    const input = [track("offline", ["classical", "70s"])];
    const original = structuredClone(input);
    const readTracks = vi.fn().mockResolvedValue(input);
    const tokenRequest = vi.fn();
    const customerRequest = vi.fn();
    const databaseWrite = vi.fn();

    const plan = await executeSoundchartsEnrichmentPlanning(
      { ...options, verbose: false },
      { readTracks },
    );

    expect(plan.selectedGroups).toHaveLength(1);
    expect(readTracks).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(tokenRequest).not.toHaveBeenCalled();
    expect(customerRequest).not.toHaveBeenCalled();
    expect(databaseWrite).not.toHaveBeenCalled();
    expect(input).toEqual(original);
    fetchSpy.mockRestore();
  });

  it("forces canary to one group, three customer requests, and no refresh", () => {
    expect(parseSoundchartsExecutionOptions([
      "--canary", "--limit=100", "--max-api-requests=999", "--refresh",
    ])).toMatchObject({ limit: 1, maxApiRequests: 3, refresh: false, canary: true });
  });
});
