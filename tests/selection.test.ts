import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRounds: vi.fn(), findUnavailable: vi.fn(), count: vi.fn(), findTrack: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    gameRound: { findMany: mocks.findRounds },
    sessionUnavailableTrack: { findMany: mocks.findUnavailable },
    gameTrack: { count: mocks.count, findFirst: mocks.findTrack },
  },
}));

import { selectRandomTrack } from "@/lib/game/selection";

describe("random track selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRounds.mockResolvedValue([{ trackId: "heard-track" }]);
    mocks.findUnavailable.mockResolvedValue([]);
    mocks.count.mockResolvedValue(1);
    mocks.findTrack.mockResolvedValue({ id: "eligible" });
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it("combines category and difficulty and excludes played/unranked tracks", async () => {
    await selectRandomTrack({ sessionId: "session", category: "rock", difficulty: "hard" });
    expect(mocks.findRounds).toHaveBeenCalledWith({
      where: { sessionId: "session", categoryId: "rock", difficulty: "hard" },
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
});
