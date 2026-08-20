import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRounds: vi.fn(), findUnavailable: vi.fn(), count: vi.fn(), findTrack: vi.fn(), deleteRounds: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    gameRound: { findMany: mocks.findRounds, deleteMany: mocks.deleteRounds },
    sessionUnavailableTrack: { findMany: mocks.findUnavailable },
    gameTrack: { count: mocks.count, findFirst: mocks.findTrack },
  },
}));

import { gameplaySelectionWhere, getSetProgress, resetSetProgress, selectRandomTrack } from "@/lib/game/selection";

type SelectionFixture = {
  playable: boolean;
  gameEligible: boolean;
  languageEligible: boolean;
  streamCount: bigint | null;
  difficulty: string | null;
  streamCountSource?: string | null;
};

function matchesSelection(track: SelectionFixture, difficulty: "hard" | "impossible" | "unranked"): boolean {
  if (!track.playable || !track.gameEligible || !track.languageEligible) return false;
  return difficulty === "unranked"
    ? track.streamCount === null || track.difficulty === null
    : track.streamCount !== null && track.difficulty === difficulty;
}

describe("random track selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRounds.mockResolvedValue([{ trackId: "heard-track" }]);
    mocks.findUnavailable.mockResolvedValue([]);
    mocks.count.mockResolvedValue(1);
    mocks.findTrack.mockResolvedValue({ id: "eligible" });
    mocks.deleteRounds.mockResolvedValue({ count: 4 });
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it("combines category and difficulty and excludes played/unranked tracks", async () => {
    await selectRandomTrack({ sessionId: "session", category: "rock", difficulty: "hard" });
    expect(mocks.findRounds).toHaveBeenCalledWith({
      where: { sessionId: "session", categoryId: "rock", difficulty: "hard", finished: true },
      select: { trackId: true },
    });
    expect(mocks.count).toHaveBeenLastCalledWith({ where: {
      playable: true,
      gameEligible: true,
      languageEligible: true,
      streamCount: { not: null },
      difficulty: "hard",
      categories: { some: { categoryId: "rock", gameEligible: true } },
      id: { notIn: ["heard-track"] },
    } });
    expect(mocks.findTrack).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
  });

  it("requires game eligibility even for a playable ranked track", async () => {
    await selectRandomTrack({ sessionId: "session", category: "all", difficulty: "impossible" });
    expect(mocks.count.mock.calls[0]?.[0].where).toMatchObject({
      playable: true,
      gameEligible: true,
      languageEligible: true,
      streamCount: { not: null },
      difficulty: "impossible",
    });
  });

  it("selects Unranked from either missing ranking field without consulting Soundcharts state", async () => {
    await selectRandomTrack({ sessionId: "session", category: "all", difficulty: "unranked" });
    expect(mocks.findRounds).toHaveBeenCalledWith({
      where: { sessionId: "session", categoryId: "all", difficulty: "unranked", finished: true },
      select: { trackId: true },
    });
    const where = mocks.count.mock.calls[0]?.[0].where as Record<string, unknown>;
    expect(where).toMatchObject({
      playable: true,
      gameEligible: true,
      languageEligible: true,
      OR: [{ streamCount: null }, { difficulty: null }],
    });
    expect(where).not.toHaveProperty("soundchartsNotFoundAt");
    expect(where).not.toHaveProperty("soundchartsUuid");
  });

  it("keeps category trust enforcement in Unranked category pools", () => {
    expect(gameplaySelectionWhere("pop", "unranked")).toMatchObject({
      categories: { some: { categoryId: "pop", gameEligible: true } },
    });
    expect(gameplaySelectionWhere("all", "unranked")).not.toHaveProperty("categories");
  });

  it.each(["playable", "gameEligible", "languageEligible"] as const)(
    "excludes Unranked tracks when %s is false",
    (flag) => {
      const track: SelectionFixture = {
        playable: true, gameEligible: true, languageEligible: true,
        streamCount: null, difficulty: null,
      };
      track[flag] = false;
      expect(matchesSelection(track, "unranked")).toBe(false);
    },
  );

  it("excludes fully ranked tracks from Unranked across every ranked difficulty", () => {
    for (const difficulty of ["easy", "normal", "hard", "extreme", "impossible"]) {
      expect(matchesSelection({
        playable: true, gameEligible: true, languageEligible: true,
        streamCount: 1n, difficulty,
      }, "unranked")).toBe(false);
    }
  });

  it("moves a track from Unranked to its ranked pool as ranking fields are populated", () => {
    const track: SelectionFixture = {
      playable: true, gameEligible: true, languageEligible: true,
      streamCount: null, difficulty: null,
    };
    expect(matchesSelection(track, "unranked")).toBe(true);
    expect(matchesSelection(track, "hard")).toBe(false);

    track.streamCount = 75_000_000n;
    track.difficulty = "hard";

    expect(matchesSelection(track, "unranked")).toBe(false);
    expect(matchesSelection(track, "hard")).toBe(true);
  });

  it("selects spotify_full tracks in their ranked difficulty and not Unranked", () => {
    const provisional: SelectionFixture = {
      playable: true,
      gameEligible: true,
      languageEligible: true,
      streamCount: 3_000_000n,
      difficulty: "impossible",
      streamCountSource: "spotify_full",
    };
    expect(matchesSelection(provisional, "unranked")).toBe(false);
    expect(matchesSelection(provisional, "impossible")).toBe(true);
    expect(gameplaySelectionWhere("all", "impossible")).not.toHaveProperty("streamCountSource");
  });

  it("accepts a ranked unknown-language track without requiring languageCode", async () => {
    await selectRandomTrack({ sessionId: "session", category: "all", difficulty: "normal" });
    const where = mocks.count.mock.calls[0]?.[0].where as Record<string, unknown>;
    expect(where.languageEligible).toBe(true);
    expect(where.languageCode).toBeUndefined();
  });

  it("does not require a category association for All", async () => {
    await selectRandomTrack({ sessionId: "session", category: "all", difficulty: "easy" });
    const where = mocks.count.mock.calls[0]?.[0].where as Record<string, unknown>;
    expect(where.categories).toBeUndefined();
  });

  it("requires an enabled relation for category play but ignores relations for All Music", async () => {
    await selectRandomTrack({ sessionId: "session", category: "r-and-b", difficulty: "impossible" });
    expect(mocks.count.mock.calls[0]?.[0].where.categories).toEqual({
      some: { categoryId: "r-and-b", gameEligible: true },
    });

    mocks.count.mockClear();
    await selectRandomTrack({ sessionId: "session", category: "all", difficulty: "impossible" });
    expect(mocks.count.mock.calls[0]?.[0].where.categories).toBeUndefined();
  });

  it("reports exhaustion instead of recycling a one-song pool", async () => {
    mocks.findRounds.mockResolvedValue([{ trackId: "only-track" }]);
    mocks.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const result = await selectRandomTrack({ sessionId: "session", category: "all", difficulty: "normal" });
    expect(result).toEqual({ status: "exhausted" });
    expect(mocks.findTrack).not.toHaveBeenCalled();
  });

  it("selects the one song on its first scoped play", async () => {
    mocks.findRounds.mockResolvedValue([]);
    const result = await selectRandomTrack({ sessionId: "session", category: "all", difficulty: "normal" });
    expect(result).toEqual({ status: "selected", track: { id: "eligible" } });
  });

  it("distinguishes an empty playable pool from an exhausted pool", async () => {
    mocks.findRounds.mockResolvedValue([{ trackId: "heard-track" }]);
    mocks.count.mockResolvedValueOnce(0);
    await expect(selectRandomTrack({ sessionId: "session", category: "all", difficulty: "normal" }))
      .resolves.toEqual({ status: "empty" });
  });

  it("allows the same track in a different category pool", async () => {
    mocks.findRounds.mockImplementation(({ where }: { where: { categoryId: string } }) =>
      Promise.resolve(where.categoryId === "pop" ? [{ trackId: "eligible" }] : []));
    mocks.count.mockImplementation(({ where }: { where: { id?: { notIn?: string[] } } }) =>
      Promise.resolve(where.id?.notIn?.includes("eligible") ? 0 : 1));

    await expect(selectRandomTrack({ sessionId: "session", category: "pop", difficulty: "normal" }))
      .resolves.toEqual({ status: "exhausted" });
    await expect(selectRandomTrack({ sessionId: "session", category: "rock", difficulty: "normal" }))
      .resolves.toEqual({ status: "selected", track: { id: "eligible" } });
  });

  it("keeps played history and exhaustion independent for Unranked", async () => {
    mocks.findRounds.mockImplementation(({ where }: { where: { difficulty: string } }) =>
      Promise.resolve(where.difficulty === "unranked" ? [{ trackId: "eligible" }] : []));
    mocks.count.mockImplementation(({ where }: { where: { id?: { notIn?: string[] } } }) =>
      Promise.resolve(where.id?.notIn?.includes("eligible") ? 0 : 1));

    await expect(selectRandomTrack({ sessionId: "session", category: "all", difficulty: "unranked" }))
      .resolves.toEqual({ status: "exhausted" });
    await expect(selectRandomTrack({ sessionId: "session", category: "all", difficulty: "hard" }))
      .resolves.toEqual({ status: "selected", track: { id: "eligible" } });
  });

  it("excludes an unavailable track only for the affected session", async () => {
    mocks.findRounds.mockResolvedValue([]);
    mocks.findUnavailable.mockImplementation(({ where }: { where: { sessionId: string } }) =>
      Promise.resolve(where.sessionId === "session-a" ? [{ trackId: "market-blocked" }] : []));

    await selectRandomTrack({ sessionId: "session-a", category: "all", difficulty: "normal" });
    expect(mocks.count.mock.calls[0]?.[0].where.id).toEqual({ notIn: ["market-blocked"] });

    mocks.count.mockClear();
    await selectRandomTrack({ sessionId: "session-b", category: "all", difficulty: "normal" });
    expect(mocks.count.mock.calls[0]?.[0].where.id).toBeUndefined();
  });

  it("does not count session-unavailable tracks as playable remaining songs", async () => {
    mocks.findRounds.mockResolvedValue([]);
    mocks.findUnavailable.mockResolvedValue([{ trackId: "market-blocked" }]);
    mocks.count.mockResolvedValue(0);
    await expect(selectRandomTrack({ sessionId: "session", category: "all", difficulty: "normal" }))
      .resolves.toEqual({ status: "empty" });
  });

  it("counts only distinct finished eligible tracks as completed progress", async () => {
    mocks.findRounds.mockResolvedValue([{ trackId: "done" }, { trackId: "done" }, { trackId: "other" }]);
    mocks.findUnavailable.mockResolvedValue([{ trackId: "blocked" }]);
    mocks.count.mockResolvedValueOnce(81).mockResolvedValueOnce(2);
    await expect(getSetProgress({ sessionId: "session", category: "rock", difficulty: "normal" }))
      .resolves.toEqual({ completed: 2, total: 81 });
    expect(mocks.findRounds).toHaveBeenCalledWith({
      where: { sessionId: "session", categoryId: "rock", difficulty: "normal", finished: true },
      select: { trackId: true },
    });
    expect(mocks.count.mock.calls[0]?.[0].where).toMatchObject({
      playable: true,
      gameEligible: true,
      languageEligible: true,
      difficulty: "normal",
      categories: { some: { categoryId: "rock", gameEligible: true } },
      id: { notIn: ["blocked"] },
    });
    expect(mocks.count.mock.calls[1]?.[0].where.id).toEqual({ in: ["done", "other"] });
  });

  it("does not increment progress for an unfinished round", async () => {
    mocks.findRounds.mockResolvedValue([]);
    mocks.count.mockResolvedValueOnce(5);
    await expect(getSetProgress({ sessionId: "session", category: "all", difficulty: "unranked" }))
      .resolves.toEqual({ completed: 0, total: 5 });
    expect(mocks.count).toHaveBeenCalledTimes(1);
  });

  it("keeps category, difficulty, and Unranked progress scopes independent", async () => {
    mocks.findRounds.mockResolvedValue([]);
    mocks.count.mockResolvedValue(3);
    await getSetProgress({ sessionId: "session", category: "pop", difficulty: "easy" });
    await getSetProgress({ sessionId: "session", category: "jazz", difficulty: "hard" });
    await getSetProgress({ sessionId: "session", category: "all", difficulty: "unranked" });
    expect(mocks.findRounds.mock.calls.map(([query]) => query.where)).toEqual([
      { sessionId: "session", categoryId: "pop", difficulty: "easy", finished: true },
      { sessionId: "session", categoryId: "jazz", difficulty: "hard", finished: true },
      { sessionId: "session", categoryId: "all", difficulty: "unranked", finished: true },
    ]);
  });

  it("reset deletes only rounds in the current set and leaves unavailable/catalog data untouched", async () => {
    await expect(resetSetProgress({ sessionId: "session", category: "rock", difficulty: "normal" })).resolves.toBe(4);
    expect(mocks.deleteRounds).toHaveBeenCalledWith({
      where: { sessionId: "session", categoryId: "rock", difficulty: "normal" },
    });
    expect(mocks.findUnavailable).not.toHaveBeenCalled();
  });
});
