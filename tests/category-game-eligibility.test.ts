import { describe, expect, it, vi } from "vitest";
import {
  evaluateSoundchartsCategoryRelations,
  validateCategoryGameplayEligibility,
  type CategoryGameplayRelation,
} from "@/lib/catalog/category-game-eligibility";

function relation(
  trackId: string,
  categoryId: string,
  gameEligible = true,
  gameEligibilitySource: string | null = null,
): CategoryGameplayRelation {
  return { trackId, categoryId, gameEligible, gameEligibilitySource };
}

describe("Soundcharts category gameplay validation", () => {
  it("rejects an unsupported existing genre while preserving the relation decision target", () => {
    const evaluation = evaluateSoundchartsCategoryRelations(
      [relation("searchers", "r-and-b")],
      [{ root: "pop", sub: [] }, { root: "rock", sub: ["folk"] }],
    );
    expect(evaluation.mappedGenreIds).toEqual(["pop", "rock"]);
    expect(evaluation.decisions).toEqual([expect.objectContaining({
      trackId: "searchers",
      categoryId: "r-and-b",
      outcome: "rejected",
      desiredGameEligible: false,
    })]);
  });

  it("confirms explicit electronic evidence and leaves folk-only evidence unchanged", () => {
    expect(evaluateSoundchartsCategoryRelations(
      [relation("captain-jack", "electronic")],
      [{ root: "electro", sub: ["electronic", "dance"] }],
    ).decisions[0]).toMatchObject({ outcome: "confirmed", desiredGameEligible: true });

    expect(evaluateSoundchartsCategoryRelations(
      [relation("folk", "rock", false, "manual")],
      [{ root: "folk", sub: [] }],
    ).decisions[0]).toEqual(expect.objectContaining({
      outcome: "insufficient-evidence",
      desiredGameEligible: null,
      needsUpdate: false,
    }));
  });

  it("updates only trust fields, preserves raw and decade relations, and is idempotent offline", async () => {
    const relations = [
      relation("searchers", "r-and-b"),
      relation("searchers", "90s"),
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const updateRelation = vi.fn(async (
      trackId: string,
      categoryId: string,
      data: { gameEligible: boolean; gameEligibilitySource: string },
    ) => {
      const stored = relations.find((item) => item.trackId === trackId && item.categoryId === categoryId);
      if (stored) {
        stored.gameEligible = data.gameEligible;
        stored.gameEligibilitySource = data.gameEligibilitySource;
      }
    });
    const input = () => [{
      id: "searchers",
      title: "I'm Never Coming Back",
      artistNames: "The Searchers",
      soundchartsGenres: [{ root: "pop", sub: [] }, { root: "rock", sub: ["folk"] }],
      categories: relations,
    }];

    const first = await validateCategoryGameplayEligibility(input(), { updateRelation });
    const second = await validateCategoryGameplayEligibility(input(), { updateRelation });

    expect(first).toMatchObject({
      genreRelationsInspected: 1,
      confirmedRelations: 0,
      rejectedRelations: 1,
      rowsUpdated: 1,
    });
    expect(second.rowsUpdated).toBe(0);
    expect(relations).toEqual([
      relation("searchers", "r-and-b", false, "soundcharts"),
      relation("searchers", "90s"),
    ]);
    expect(updateRelation).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
