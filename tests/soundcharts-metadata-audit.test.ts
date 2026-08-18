import { describe, expect, it, vi } from "vitest";
import {
  buildSoundchartsMetadataAudit,
  type SoundchartsMetadataAuditTrack,
} from "@/lib/catalog/soundcharts-metadata-audit";

function track(overrides: Partial<SoundchartsMetadataAuditTrack> = {}): SoundchartsMetadataAuditTrack {
  return {
    id: "track",
    spotifyTrackId: "spotify-track",
    title: "Song",
    artistNames: "Artist",
    releaseDate: "1980-01-01",
    soundchartsReleaseDate: "1980-09-08T00:00:00+00:00",
    soundchartsGenresJson: JSON.stringify([{ root: "Pop", sub: ["Art Pop"] }]),
    streamCount: 100n,
    categories: [{ categoryId: "pop", gameEligible: true, gameEligibilitySource: null }],
    ...overrides,
  };
}

describe("Soundcharts metadata audit", () => {
  it("compares release dates and reports actual root and subgenre strings", () => {
    const audit = buildSoundchartsMetadataAudit([
      track(),
      track({
        id: "different",
        spotifyTrackId: "spotify-different",
        releaseDate: "1979",
        soundchartsReleaseDate: "1980-01-01",
        soundchartsGenresJson: JSON.stringify([{ root: "Rock", sub: ["New Wave"] }]),
      }),
      track({
        id: "missing-spotify",
        spotifyTrackId: "spotify-missing-one",
        releaseDate: null,
        soundchartsReleaseDate: "2000-01-01",
      }),
      track({
        id: "missing-soundcharts",
        spotifyTrackId: "spotify-missing-two",
        soundchartsReleaseDate: null,
      }),
      track({
        id: "no-metadata",
        spotifyTrackId: "spotify-no-metadata",
        soundchartsReleaseDate: null,
        soundchartsGenresJson: null,
      }),
    ]);

    expect(audit).toMatchObject({
      metadataBearingTracks: 4,
      sameYear: 1,
      differentYear: 1,
      differentDecade: 1,
      missingSpotifyDate: 1,
      missingSoundchartsDate: 1,
    });
    expect(audit.rootGenres).toEqual([
      { value: "Pop", count: 3 },
      { value: "Rock", count: 1 },
    ]);
    expect(audit.subgenres).toEqual([
      { value: "Art Pop", count: 3 },
      { value: "New Wave", count: 1 },
    ]);
    expect(audit.differentDecadeExamples[0]).toMatchObject({ title: "Song" });
  });

  it("flags only conservative potential mismatches on metadata-bearing ranked tracks", () => {
    const audit = buildSoundchartsMetadataAudit([
      track(),
      track({
        id: "mismatch",
        spotifyTrackId: "spotify-mismatch",
        categories: [{ categoryId: "classical", gameEligible: false, gameEligibilitySource: "soundcharts" }],
      }),
      track({
        id: "unranked",
        spotifyTrackId: "spotify-unranked",
        streamCount: null,
        categories: [{ categoryId: "classical", gameEligible: true, gameEligibilitySource: null }],
      }),
    ]);

    expect(audit.potentialMismatches).toEqual([expect.objectContaining({
      rawLocalGenres: ["Classical"],
      gameplayEnabledGenres: [],
      mappedSoundchartsGenres: ["Pop"],
      soundchartsRootGenres: ["Pop"],
    })]);
  });

  it("is a pure local calculation and performs no network or writes", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    buildSoundchartsMetadataAudit([track()]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
