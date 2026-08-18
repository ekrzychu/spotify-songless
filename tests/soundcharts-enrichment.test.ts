import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnrichmentRecordingGroup, EnrichmentTrackCandidate } from "@/lib/streams/enrichment-selection";

const database = vi.hoisted(() => ({
  gameTrack: { updateMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: database }));

import { enrichRecordingGroup } from "@/lib/streams/soundcharts-enrichment";

const representative: EnrichmentTrackCandidate = {
  id: "track-1",
  spotifyTrackId: "1234567890123456789012",
  isrc: "USABC1234567",
  title: "Test",
  artistNames: "Artist",
  streamCount: null,
  streamCountSource: null,
  soundchartsUuid: null,
  difficulty: null,
  playable: true,
  gameEligible: true,
  categories: [{ categoryId: "pop" }],
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
      where: { id: { in: ["track-1", "track-2"] }, streamCount: null },
      data: {
        soundchartsUuid: "soundcharts-uuid",
        soundchartsReleaseDate: "1980-09-08T00:00:00+00:00",
        soundchartsGenresJson: JSON.stringify([{ root: "Pop", sub: ["Art Pop"] }]),
        streamCount: 1_000_000_000n,
        difficulty: "easy",
        streamCountSource: "soundcharts",
        streamCountUpdatedAt: now,
      },
    });
    expect(database).not.toHaveProperty("trackCategory");
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
      where: { id: { in: ["track-1"] }, streamCount: null },
      data: {
        soundchartsUuid: "soundcharts-uuid",
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
      OR: [{ streamCount: null }, { streamCountSource: "soundcharts" }],
    });
  });
});
