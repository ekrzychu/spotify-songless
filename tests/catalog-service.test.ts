import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpotifyTrack } from "@/lib/spotify/api";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsertTrack: vi.fn(),
  upsertCategory: vi.fn(),
  assignDerivedCategories: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    gameTrack: { findUnique: mocks.findUnique, upsert: mocks.upsertTrack },
    trackCategory: { upsert: mocks.upsertCategory },
  },
}));
vi.mock("@/lib/catalog/derived-categories", () => ({
  assignDerivedCategories: mocks.assignDerivedCategories,
}));

import { upsertCatalogTrack } from "@/lib/catalog/catalog-service";

const track: SpotifyTrack = {
  id: "0123456789012345678901",
  uri: "spotify:track:0123456789012345678901",
  name: "Rediscovered",
  external_ids: { isrc: "US-ABC-12-34567" },
  external_urls: { spotify: "https://open.spotify.com/track/0123456789012345678901" },
  artists: [{ id: "artist", name: "Artist" }],
  album: { name: "Album", release_date: "2020-01-02" },
};

describe("catalog metadata upsert preservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ id: "database-track" });
    mocks.upsertTrack.mockResolvedValue({ id: "database-track", releaseDate: "2020-01-02" });
    mocks.upsertCategory.mockResolvedValue({});
    mocks.assignDerivedCategories.mockResolvedValue("2020s");
  });

  it("never includes stream, difficulty, or Soundcharts enrichment in Spotify update data", async () => {
    await expect(upsertCatalogTrack(track, "pop")).resolves.toBe("updated");
    const update = mocks.upsertTrack.mock.calls[0]?.[0].update as Record<string, unknown>;
    expect(update).toMatchObject({ title: "Rediscovered", releaseDate: "2020-01-02" });
    for (const field of [
      "streamCount", "difficulty", "soundchartsUuid", "streamCountSource", "streamCountUpdatedAt",
    ]) {
      expect(update).not.toHaveProperty(field);
    }
    expect(mocks.upsertCategory).toHaveBeenCalledWith(expect.objectContaining({
      where: { trackId_categoryId: { trackId: "database-track", categoryId: "pop" } },
    }));
    expect(mocks.assignDerivedCategories).toHaveBeenCalledWith("database-track", "2020-01-02");
  });
});
