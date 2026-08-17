import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRounds: vi.fn(), count: vi.fn(), findTrack: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    gameRound: { findMany: mocks.findRounds },
    gameTrack: { count: mocks.count, findFirst: mocks.findTrack },
  },
}));

import { getRandomTrack } from "@/lib/game/selection";

describe("random track selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRounds.mockResolvedValue([{ trackId: "heard-track" }]);
    mocks.count.mockResolvedValue(1);
    mocks.findTrack.mockResolvedValue({ id: "eligible" });
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it("combines category and difficulty and excludes played/unranked tracks", async () => {
    await getRandomTrack({ sessionId: "session", category: "rock", difficulty: "hard" });
    expect(mocks.count).toHaveBeenCalledWith({ where: {
      playable: true,
      streamCount: { not: null },
      difficulty: "hard",
      categories: { some: { categoryId: "rock" } },
      id: { notIn: ["heard-track"] },
    } });
    expect(mocks.findTrack).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
  });

  it("does not require a category association for All", async () => {
    await getRandomTrack({ sessionId: "session", category: "all", difficulty: "easy" });
    const where = mocks.count.mock.calls[0]?.[0].where as Record<string, unknown>;
    expect(where.categories).toBeUndefined();
  });

  it("resets exclusions after catalog exhaustion without immediate repeat", async () => {
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    await getRandomTrack({ sessionId: "session", category: "all", difficulty: "normal" });
    expect(mocks.count).toHaveBeenLastCalledWith({ where: expect.objectContaining({ id: { not: "heard-track" } }) });
  });
});
