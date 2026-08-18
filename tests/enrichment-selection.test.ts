import { describe, expect, it, vi } from "vitest";
import {
  ACTIVE_ENRICHMENT_CATEGORIES,
  buildRankedCoverageMatrix,
  buildSoundchartsEnrichmentPlan,
  executeSoundchartsEnrichmentPlanning,
  formatSoundchartsEnrichmentPlan,
  groupEnrichmentCandidates,
  parseSoundchartsExecutionOptions,
  parseSoundchartsPlanningOptions,
  type EnrichmentTrackCandidate,
  type SoundchartsSelectionOptions,
} from "@/lib/streams/enrichment-selection";
import { RANKED_DIFFICULTIES, type RankedDifficulty } from "@/types/game";

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
    albumName: `Album ${id}`,
    streamCount: null,
    streamCountSource: null,
    soundchartsUuid: null,
    soundchartsNotFoundAt: null,
    difficulty: null,
    playable: true,
    gameEligible: true,
    languageCode: "en",
    languageSource: "detector",
    languageEligible: true,
    categories: categories.map((categoryId) => ({ categoryId, gameEligible: true })),
    ...overrides,
  };
}

const options: SoundchartsSelectionOptions = {
  limit: 100,
  targetPerCell: 10,
  includeCachedUnranked: false,
  includeNotFound: false,
  includeNonSonglike: false,
  refresh: false,
};

function ranked(
  id: string,
  categoryIds: string[],
  difficulty: RankedDifficulty,
  overrides: Partial<EnrichmentTrackCandidate> = {},
): EnrichmentTrackCandidate {
  return track(id, categoryIds, {
    streamCount: 1n,
    streamCountSource: "soundcharts",
    difficulty,
    ...overrides,
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

  it("excludes game-ineligible and unplayable targets from normal enrichment", () => {
    const groups = groupEnrichmentCandidates([
      track("eligible", "pop"),
      track("ineligible", "rock", { gameEligible: false }),
      track("unplayable", "classical", { playable: false }),
    ]);

    expect(groups.map((group) => group.representative.id)).toEqual(["eligible"]);
  });

  it("targets only the eligible local version in a mixed ISRC group", () => {
    const groups = groupEnrichmentCandidates([
      track("eligible", "pop", { isrc: "USABC1234567" }),
      track("ineligible", "rock", { isrc: "USABC1234567", gameEligible: false }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.targetTrackIds).toEqual(["eligible"]);
    expect(groups[0]?.tracks.map((candidate) => candidate.id)).toEqual(["eligible"]);
    expect(groups[0]?.categoryIds).toEqual(["pop"]);
  });

  it("targets unknown and allowed-classified versions but not a rejected-classified sibling", () => {
    const groups = groupEnrichmentCandidates([
      track("unknown", "pop", {
        isrc: "USABC1234567", languageCode: null, languageSource: "unknown", languageEligible: true,
      }),
      track("english", "pop", { isrc: "USABC1234567" }),
      track("german", "rock", {
        isrc: "USABC1234567", languageCode: "de", languageEligible: false,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.targetTrackIds).toEqual(["unknown", "english"]);
    expect(groups[0]?.tracks.map((candidate) => candidate.id).sort()).toEqual(["english", "unknown"]);
  });

  it("accepts unknown and uncertain language states without requiring a code", () => {
    const groups = groupEnrichmentCandidates([
      track("allowed", "pop"),
      track("polish", "pop", { languageCode: "pl", languageEligible: true }),
      track("spanish", "pop", { languageCode: "es", languageEligible: true }),
      track("unknown", "rock", {
        languageCode: null, languageSource: "unknown", languageEligible: true,
      }),
      track("uncertain", "rock", {
        languageCode: null, languageSource: "detector-uncertain", languageEligible: true,
      }),
      track("disallowed", "rock", { languageCode: "de", languageEligible: false }),
      track("bad-flag", "rock", { languageCode: "en", languageEligible: false }),
    ]);
    expect(groups.map((group) => group.representative.id).sort()).toEqual([
      "allowed", "polish", "spanish", "uncertain", "unknown",
    ]);
  });
});

describe("neutral Soundcharts planning", () => {
  it("builds the active genre and decade difficulty matrix from ranked tracks", () => {
    const coverage = buildRankedCoverageMatrix([
      ranked("pop-easy", ["pop", "80s"], "easy"),
      ranked("hip-hard", ["hip-hop", "90s", "jazz"], "hard"),
      ranked("vinheta", ["r-and-b", "2000s"], "impossible", {
        title: "Vinheta 1 (SKIT)",
        playable: true,
        gameEligible: false,
      }),
      ranked("unplayable", ["rock", "70s"], "normal", { playable: false }),
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
    expect(coverage.allMusic.impossible).toBe(0);
    expect(coverage.allMusic.normal).toBe(0);
    expect(coverage.categories["r-and-b"]?.impossible).toBe(0);
    expect(coverage.categories.rock?.normal).toBe(0);
    expect(coverage.categories).not.toHaveProperty("jazz");
  });

  it("distinguishes raw ranking from actual gameplay-ranked coverage", () => {
    const plan = buildSoundchartsEnrichmentPlan([
      ranked("eligible", ["pop"], "easy"),
      ranked("vinheta", ["r-and-b"], "impossible", {
        title: "Vinheta 1 (SKIT)",
        playable: true,
        gameEligible: false,
      }),
      ranked("unplayable", ["rock"], "hard", { playable: false }),
      track("unranked", ["classical"]),
    ], options);

    expect(plan).toMatchObject({
      catalogTracks: 4,
      rawRankedTracks: 3,
      gameplayRankedTracks: 1,
      gameIneligibleRankedTracks: 1,
      unplayableRankedTracks: 1,
      unrankedTracks: 1,
    });
    expect(plan.coverage.allMusic).toEqual({
      easy: 1,
      normal: 0,
      hard: 0,
      extreme: 0,
      impossible: 0,
    });
  });

  it("counts a disabled genre relation in All Music but not that genre's gameplay coverage", () => {
    const disabledRnb = ranked("searchers", ["r-and-b", "60s"], "hard", {
      categories: [
        { categoryId: "r-and-b", gameEligible: false },
        { categoryId: "90s", gameEligible: true },
      ],
    });
    const coverage = buildRankedCoverageMatrix([disabledRnb]);

    expect(coverage.allMusic.hard).toBe(1);
    expect(coverage.categories["r-and-b"]?.hard).toBe(0);
    expect(coverage.categories["90s"]?.hard).toBe(1);
  });

  it("keeps identical candidate order when category coverage and targets change radically", () => {
    const candidates = [
      track("candidate-a", ["pop", "2010s"]),
      track("candidate-b", ["hip-hop", "80s"]),
      track("candidate-c", ["rock", "90s"]),
    ];
    const popCoverage = RANKED_DIFFICULTIES.map((difficulty) => ranked(`pop-${difficulty}`, ["pop", "2010s"], difficulty));
    const hipCoverage = RANKED_DIFFICULTIES.map((difficulty) => ranked(`hip-${difficulty}`, ["hip-hop", "80s"], difficulty));
    const first = buildSoundchartsEnrichmentPlan([...popCoverage, ...candidates], { ...options, targetPerCell: 1 });
    const second = buildSoundchartsEnrichmentPlan([...hipCoverage, ...candidates], { ...options, targetPerCell: 999 });

    expect(first.selectedGroups.map((group) => group.representative.id))
      .toEqual(second.selectedGroups.map((group) => group.representative.id));
  });

  it("does not let targetPerCell 1, 10, or 100 change selection order", () => {
    const candidates = [
      track("candidate-a", ["pop", "2010s"]),
      track("candidate-b", ["hip-hop", "80s"], { isrc: "USAAA1234567" }),
      track("candidate-c", ["rock", "90s"]),
    ];
    const orders = [1, 10, 100].map((targetPerCell) => buildSoundchartsEnrichmentPlan(
      candidates, { ...options, targetPerCell },
    ).selectedGroups.map((group) => group.key));
    expect(orders[1]).toEqual(orders[0]);
    expect(orders[2]).toEqual(orders[0]);
  });

  it("orders neutrally by represented target count, normalized ISRC, then stable key", () => {
    const plan = buildSoundchartsEnrichmentPlan([
      track("group-a", "pop", { isrc: "USAAA1234567" }),
      track("group-b", "rock", { isrc: "USAAA1234567" }),
      track("single-isrc", "pop", { isrc: "USBBB1234567" }),
      track("single-spotify", "pop"),
    ], options);

    expect(plan.selectedGroups[0]?.targetTrackIds).toHaveLength(2);
    expect(plan.selectedGroups[1]?.normalizedIsrc).not.toBeNull();
    expect(plan.selectedGroups[2]?.normalizedIsrc).toBeNull();
  });

  it("does not score a rejected candidate category relation", () => {
    const plan = buildSoundchartsEnrichmentPlan([
      track("candidate", ["pop"], {
        categories: [
          { categoryId: "pop", gameEligible: true },
          { categoryId: "r-and-b", gameEligible: false },
          { categoryId: "80s", gameEligible: true },
        ],
      }),
    ], options);

    expect(plan.selectedGroups[0]?.activeCategoryIds).toEqual(["pop", "80s"]);
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

  it("excludes an all-marked group by default and retries it only when explicit", () => {
    const failedAt = new Date("2026-08-18T12:00:00Z");
    const fresh = track("fresh", "pop");
    const failed = track("failed", "rock", { soundchartsNotFoundAt: failedAt });
    const normal = buildSoundchartsEnrichmentPlan([fresh, failed], options);
    const retry = buildSoundchartsEnrichmentPlan([fresh, failed], { ...options, includeNotFound: true });

    expect(normal).toMatchObject({
      freshUnrankedGroups: 1,
      previouslyNotFoundGroups: 1,
      includeNotFound: false,
    });
    expect(normal.selectedGroups.map((group) => group.representative.id)).toEqual(["fresh"]);
    expect(retry.selectedGroups.map((group) => group.representative.id)).toContain("failed");
    expect(formatSoundchartsEnrichmentPlan(normal)).toContain("Include previously not found: no");
  });

  it("keeps a mixed-marker recording group eligible when it has a new target", () => {
    const candidates = [
      track("previous-miss", "pop", {
        isrc: "USABC1234567", soundchartsNotFoundAt: new Date("2026-08-18T12:00:00Z"),
      }),
      track("new-target", "rock", { isrc: "USABC1234567" }),
    ];
    const plan = buildSoundchartsEnrichmentPlan(candidates, options);

    expect(plan.previouslyNotFoundGroups).toBe(0);
    expect(plan.selectedGroups).toHaveLength(1);
    expect(plan.selectedGroups[0]?.targetTrackIds.sort()).toEqual(["new-target", "previous-miss"]);
  });

  it("uses one shared selector for plan and execution-equivalent options", () => {
    const candidates = [
      track("a", ["pop", "80s"]),
      track("b", ["rock", "90s"]),
      track("skit", ["hip-hop", "90s"], { title: "Track Name (SKIT)" }),
    ];
    const planningOptions = parseSoundchartsPlanningOptions([
      "--limit=1", "--target-per-cell=7", "--include-cached-unranked", "--include-not-found",
    ]);
    const executionOptions = parseSoundchartsExecutionOptions([
      "--limit=1", "--target-per-cell=7", "--include-cached-unranked", "--include-not-found",
      "--max-api-requests=3",
    ]);
    const planning = buildSoundchartsEnrichmentPlan(candidates, planningOptions);
    const execution = buildSoundchartsEnrichmentPlan(candidates, executionOptions);
    expect(planning.selectedGroups.map((group) => group.key))
      .toEqual(execution.selectedGroups.map((group) => group.key));
    expect(planning.selectedGroups.some((group) => group.representative.id === "skit")).toBe(false);

    const planningOverride = buildSoundchartsEnrichmentPlan(candidates, {
      ...planningOptions,
      includeNonSonglike: true,
      limit: 100,
    });
    const executionOverride = buildSoundchartsEnrichmentPlan(candidates, {
      ...executionOptions,
      includeNonSonglike: true,
      limit: 100,
    });
    expect(planningOverride.selectedGroups.map((group) => group.key))
      .toEqual(executionOverride.selectedGroups.map((group) => group.key));
    expect(planningOverride.selectedGroups.some((group) => group.representative.id === "skit")).toBe(true);
  });

  it("does not let the non-song override bypass persistent game eligibility", () => {
    const candidates = [
      track("music", ["pop", "80s"], { title: "Boys Don't Cry" }),
      track("vinheta", ["r-and-b", "90s"], {
        title: "Vinheta 1 (SKIT)",
        playable: true,
        gameEligible: false,
      }),
    ];
    const defaultPlan = buildSoundchartsEnrichmentPlan(candidates, options);
    const qualityOverridePlan = buildSoundchartsEnrichmentPlan(candidates, {
      ...options,
      includeNonSonglike: true,
    });

    expect(defaultPlan.selectedGroups.map((group) => group.representative.id)).toEqual(["music"]);
    expect(qualityOverridePlan.selectedGroups.map((group) => group.representative.id)).toEqual(["music"]);
  });

  it("allows large zero-network plans while validating planning controls", () => {
    expect(parseSoundchartsPlanningOptions([
      "--limit=500", "--target-per-cell=12", "--include-cached-unranked", "--include-non-songlike", "--verbose",
    ])).toMatchObject({
      limit: 500,
      targetPerCell: 12,
      includeCachedUnranked: true,
      includeNotFound: false,
      includeNonSonglike: true,
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

  it("reports quality exclusions by reason and supports the shared override", () => {
    const candidates = [
      track("music", ["pop", "80s"], { title: "Boys Don't Cry" }),
      track("skit", ["hip-hop", "90s"], { title: "Track Name [SKIT]" }),
      track("interview", ["hip-hop", "90s"], { title: "Vinheta (Entrevistas)" }),
    ];
    const defaultPlan = buildSoundchartsEnrichmentPlan(candidates, options);
    const overridePlan = buildSoundchartsEnrichmentPlan(candidates, { ...options, includeNonSonglike: true });

    expect(defaultPlan).toMatchObject({
      excludedNonSonglikeGroups: 2,
      excludedNonSonglikeByReason: { skit: 1, interview: 1 },
    });
    expect(defaultPlan.selectedGroups.map((group) => group.representative.id)).toEqual(["music"]);
    expect(overridePlan.selectedGroups).toHaveLength(3);
  });
});
