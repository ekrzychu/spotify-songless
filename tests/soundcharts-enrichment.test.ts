import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnrichmentRecordingGroup, EnrichmentTrackCandidate } from "@/lib/streams/enrichment-selection";

const database = vi.hoisted(() => ({
  gameTrack: { updateMany: vi.fn() },
  trackCategory: { findMany: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: database }));

import { enrichRecordingGroup } from "@/lib/streams/soundcharts-enrichment";

const representative: EnrichmentTrackCandidate = {
  id: "track-1",
  spotifyTrackId: "1234567890123456789012",
  isrc: "USABC1234567",
  title: "Test",
  artistNames: "Artist",
  albumName: "Album",
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
  categories: [{ categoryId: "pop", gameEligible: true }],
};

const group: EnrichmentRecordingGroup = {
  key: "isrc:USABC1234567",
  normalizedIsrc: "USABC1234567",
  tracks: [representative],
  targetTrackIds: ["track-1"],
  representative,
  categoryIds: ["pop"],
  cachedSoundchartsUuid: null,
  hasConflictingCachedUuids: false,
};

describe("Soundcharts database enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.gameTrack.updateMany.mockResolvedValue({ count: 1 });
    database.trackCategory.findMany.mockResolvedValue([]);
    database.trackCategory.update.mockResolvedValue({});
  });

  it("atomically writes provenance and the existing centralized difficulty", async () => {
    const now = new Date("2026-08-17T12:00:00Z");
    const provider = {
      getStreamCountResult: vi.fn().mockResolvedValue({
        soundchartsUuid: "soundcharts-uuid",
        streamCount: 1_000_000_000,
        audienceDate: "2026-08-16T00:00:00Z",
        identifierCount: 2,
        uniqueValueCount: 2,
        resolutionSource: "spotify",
        soundchartsReleaseDate: "1980-09-08T00:00:00+00:00",
        soundchartsGenres: [{ root: "Pop", sub: ["Art Pop"] }],
      }),
    };

    database.gameTrack.updateMany.mockResolvedValue({ count: 2 });
    const twoTrackGroup = { ...group, targetTrackIds: ["track-1", "track-2"] };
    const result = await enrichRecordingGroup(twoTrackGroup, provider, { now });

    expect(result).toMatchObject({ status: "updated", localTracksUpdated: 2, difficulty: "easy" });
    expect(database.gameTrack.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["track-1", "track-2"] },
        languageEligible: true,
        OR: [
          { streamCount: null },
          { streamCountSource: "spotify_full" },
        ],
      },
      data: {
        soundchartsUuid: "soundcharts-uuid",
        soundchartsNotFoundAt: null,
        soundchartsReleaseDate: "1980-09-08T00:00:00+00:00",
        soundchartsGenresJson: JSON.stringify([{ root: "Pop", sub: ["Art Pop"] }]),
        streamCount: 1_000_000_000n,
        difficulty: "easy",
        streamCountSource: "soundcharts",
        streamCountUpdatedAt: now,
      },
    });
    expect(database.trackCategory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ trackId: { in: ["track-1", "track-2"] } }),
    }));
  });

  it("stores only the reusable UUID when audience data is unavailable", async () => {
    const provider = {
      getStreamCountResult: vi.fn().mockResolvedValue({
        soundchartsUuid: "soundcharts-uuid",
        streamCount: null,
        audienceDate: null,
        identifierCount: 0,
        uniqueValueCount: 0,
        resolutionSource: "spotify",
        soundchartsReleaseDate: "1980-09-08T00:00:00+00:00",
        soundchartsGenres: [{ root: "Pop", sub: ["Art Pop"] }],
      }),
    };

    const result = await enrichRecordingGroup(group, provider);

    expect(result).toMatchObject({ status: "audience_unavailable", difficulty: null });
    expect(database.gameTrack.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["track-1"] },
        languageEligible: true,
        OR: [
          { streamCount: null },
          { streamCountSource: "spotify_full" },
        ],
      },
      data: {
        soundchartsUuid: "soundcharts-uuid",
        soundchartsNotFoundAt: null,
        soundchartsReleaseDate: "1980-09-08T00:00:00+00:00",
        soundchartsGenresJson: JSON.stringify([{ root: "Pop", sub: ["Art Pop"] }]),
      },
    });
  });

  it("refreshes only missing or Soundcharts-owned values", async () => {
    const provider = {
      getStreamCountResult: vi.fn().mockResolvedValue({
        soundchartsUuid: "soundcharts-uuid",
        streamCount: 10,
        audienceDate: "2026-08-16T00:00:00Z",
        identifierCount: 1,
        uniqueValueCount: 1,
        resolutionSource: "cached",
        soundchartsReleaseDate: null,
        soundchartsGenres: null,
      }),
    };

    await enrichRecordingGroup(group, provider, { refresh: true });

    expect(database.gameTrack.updateMany.mock.calls[0]?.[0].where).toEqual({
      id: { in: ["track-1"] },
      languageEligible: true,
      OR: [
        { streamCount: null },
        { streamCountSource: "spotify_full" },
        { streamCountSource: "soundcharts" },
      ],
    });
    expect(database.trackCategory.findMany).not.toHaveBeenCalled();
  });

  it("replaces provisional spotify_full values after verified Soundcharts success", async () => {
    const provider = {
      getStreamCountResult: vi.fn().mockResolvedValue({
        soundchartsUuid: "verified-uuid", streamCount: 50_000_000, audienceDate: "2026-08-20",
        identifierCount: 1, uniqueValueCount: 1, resolutionSource: "spotify",
        soundchartsReleaseDate: null, soundchartsGenres: null,
      }),
    };
    await enrichRecordingGroup(group, provider);
    expect(database.gameTrack.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { OR: expect.arrayContaining([{ streamCountSource: "spotify_full" }]) },
      data: { streamCount: 50_000_000n, difficulty: "hard", streamCountSource: "soundcharts" },
    });
  });

  it("preserves provisional stream fields when Soundcharts audience data is unavailable", async () => {
    const provider = {
      getStreamCountResult: vi.fn().mockResolvedValue({
        soundchartsUuid: "cached-uuid", streamCount: null, audienceDate: null,
        identifierCount: 0, uniqueValueCount: 0, resolutionSource: "spotify",
        soundchartsReleaseDate: null, soundchartsGenres: null,
      }),
    };
    await enrichRecordingGroup(group, provider);
    const call = database.gameTrack.updateMany.mock.calls[0]?.[0];
    expect(call.where.OR).toContainEqual({ streamCountSource: "spotify_full" });
    expect(call.data).not.toHaveProperty("streamCount");
    expect(call.data).not.toHaveProperty("difficulty");
    expect(call.data).not.toHaveProperty("streamCountSource");
  });

  it("validates existing active genre relations after fresh metadata without adding or deleting rows", async () => {
    const now = new Date("2026-08-18T12:00:00Z");
    database.trackCategory.findMany.mockResolvedValue([{
      trackId: "track-1",
      categoryId: "r-and-b",
      gameEligible: true,
      gameEligibilitySource: null,
    }]);
    const provider = {
      getStreamCountResult: vi.fn().mockResolvedValue({
        soundchartsUuid: "soundcharts-uuid",
        streamCount: 100,
        audienceDate: "2026-08-18T00:00:00Z",
        identifierCount: 1,
        uniqueValueCount: 1,
        resolutionSource: "spotify",
        soundchartsReleaseDate: null,
        soundchartsGenres: [{ root: "pop", sub: [] }, { root: "rock", sub: ["folk"] }],
      }),
    };

    await enrichRecordingGroup(group, provider, { now });

    expect(database.trackCategory.update).toHaveBeenCalledWith({
      where: { trackId_categoryId: { trackId: "track-1", categoryId: "r-and-b" } },
      data: {
        gameEligible: false,
        gameEligibilitySource: "soundcharts",
        gameEligibilityUpdatedAt: now,
      },
    });
    expect(database.trackCategory).not.toHaveProperty("delete");
    expect(database.trackCategory).not.toHaveProperty("create");
  });
});
