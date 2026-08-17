import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  gameTrack: { findMany: vi.fn() },
  trackCategory: { deleteMany: vi.fn(), upsert: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: database }));

import {
  assignDerivedCategories,
  backfillDerivedCategories,
  DECADE_CATEGORY_IDS,
} from "@/lib/catalog/derived-categories";

describe("derived decade category assignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.trackCategory.deleteMany.mockResolvedValue({ count: 0 });
    database.trackCategory.upsert.mockResolvedValue({ trackId: "track-1", categoryId: "2020s" });
  });

  it("removes only stale decade relations and upserts the derived relation", async () => {
    await expect(assignDerivedCategories("track-1", "2024-05-01")).resolves.toBe("2020s");

    expect(database.trackCategory.deleteMany).toHaveBeenCalledWith({
      where: {
        trackId: "track-1",
        categoryId: { in: DECADE_CATEGORY_IDS.filter((id) => id !== "2020s") },
      },
    });
    expect(database.trackCategory.upsert).toHaveBeenCalledWith({
      where: { trackId_categoryId: { trackId: "track-1", categoryId: "2020s" } },
      create: { trackId: "track-1", categoryId: "2020s" },
      update: {},
    });
  });

  it("clears stale decade relations without touching genres when the date is invalid", async () => {
    await expect(assignDerivedCategories("track-1", null)).resolves.toBeNull();

    expect(database.trackCategory.deleteMany).toHaveBeenCalledWith({
      where: { trackId: "track-1", categoryId: { in: DECADE_CATEGORY_IDS } },
    });
    expect(database.trackCategory.upsert).not.toHaveBeenCalled();
  });

  it("reconciles existing tracks and reports each resulting decade", async () => {
    database.gameTrack.findMany.mockResolvedValue([
      { id: "track-1", releaseDate: "1975" },
      { id: "track-2", releaseDate: "2008-04-02" },
      { id: "track-3", releaseDate: "unknown" },
    ]);

    const summary = await backfillDerivedCategories();

    expect(summary).toMatchObject({
      scanned: 3,
      assigned: 2,
      unassigned: 1,
      byDecade: { "70s": 1, "2000s": 1 },
    });
    expect(database.trackCategory.upsert).toHaveBeenCalledTimes(2);
  });
});
