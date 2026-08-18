import { describe, expect, it, vi } from "vitest";
import {
  backfillGameEligibility,
  deriveGameEligibility,
  type GameEligibilityTrack,
} from "@/lib/catalog/game-eligibility";

describe("gameplay eligibility", () => {
  it("excludes an obvious skit and keeps a normal song", () => {
    expect(deriveGameEligibility("Vinheta 1 (SKIT)")).toEqual({
      gameEligible: false,
      reason: "skit",
    });
    expect(deriveGameEligibility("Boys Don't Cry")).toEqual({
      gameEligible: true,
      reason: null,
    });
  });

  it("backfills wrong values idempotently without network access", async () => {
    const tracks: GameEligibilityTrack[] = [
      { id: "skit", title: "Vinheta 1 (SKIT)", gameEligible: true },
      { id: "song", title: "Boys Don't Cry", gameEligible: false },
      { id: "already-correct", title: "A Song", gameEligible: true },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const updateEligibility = vi.fn(async (id: string, gameEligible: boolean) => {
      const track = tracks.find((candidate) => candidate.id === id);
      if (track) track.gameEligible = gameEligible;
    });
    const dependencies = {
      readTracks: vi.fn(async () => tracks),
      updateEligibility,
    };

    const first = await backfillGameEligibility(dependencies);
    const second = await backfillGameEligibility(dependencies);

    expect(first).toMatchObject({ scanned: 3, eligible: 2, excluded: 1, updated: 2 });
    expect(first.byReason.skit).toBe(1);
    expect(second).toMatchObject({ scanned: 3, eligible: 2, excluded: 1, updated: 0 });
    expect(updateEligibility).toHaveBeenCalledTimes(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
