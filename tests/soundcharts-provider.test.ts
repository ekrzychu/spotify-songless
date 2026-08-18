import { describe, expect, it, vi } from "vitest";
import { SoundchartsApiError } from "@/lib/soundcharts/client";
import {
  DefinitiveSoundchartsNotFoundError,
  SoundchartsStreamCountProvider,
  type SoundchartsProviderClient,
} from "@/lib/streams/soundcharts-provider";

function client(overrides: Partial<SoundchartsProviderClient> = {}): SoundchartsProviderClient {
  return {
    quotaRemaining: 500,
    getSongBySpotifyId: vi.fn().mockResolvedValue({
      uuid: "resolved-uuid",
      releaseDate: "1980-09-08T00:00:00+00:00",
      genres: [{ root: "Pop", sub: ["Art Pop"] }],
    }),
    getSongByIsrc: vi.fn().mockResolvedValue({
      uuid: "isrc-uuid",
      releaseDate: null,
      genres: null,
    }),
    getLatestSpotifyAudienceSnapshot: vi.fn().mockResolvedValue({
      date: "2026-08-16T00:00:00+00:00",
      plots: [
        { identifier: "spotify-a", value: 5_400_000 },
        { identifier: "spotify-b", value: 600_000 },
        { identifier: "spotify-c", value: 600_000 },
      ],
    }),
    ...overrides,
  };
}

describe("SoundchartsStreamCountProvider", () => {
  it("uses a cached UUID without calling either resolver", async () => {
    const api = client();
    const provider = new SoundchartsStreamCountProvider(api);
    const result = await provider.getStreamCountResult({
      spotifyTrackId: "spotify-id",
      isrc: "USABC1234567",
      soundchartsUuid: "cached-uuid",
    });

    expect(api.getSongBySpotifyId).not.toHaveBeenCalled();
    expect(api.getSongByIsrc).not.toHaveBeenCalled();
    expect(api.getLatestSpotifyAudienceSnapshot).toHaveBeenCalledWith("cached-uuid");
    expect(result).toMatchObject({
      soundchartsUuid: "cached-uuid",
      streamCount: 6_000_000,
      identifierCount: 3,
      uniqueValueCount: 2,
      resolutionSource: "cached",
      soundchartsReleaseDate: null,
      soundchartsGenres: null,
    });
  });

  it("falls back to exact ISRC resolution after a Spotify-ID 404", async () => {
    const api = client({
      getSongBySpotifyId: vi.fn().mockRejectedValue(new SoundchartsApiError("not_found", 404)),
    });
    const provider = new SoundchartsStreamCountProvider(api);
    const result = await provider.getStreamCountResult({ spotifyTrackId: "spotify-id", isrc: "USABC1234567" });

    expect(api.getSongByIsrc).toHaveBeenCalledWith("USABC1234567");
    expect(result.resolutionSource).toBe("isrc");
    expect(result.soundchartsUuid).toBe("isrc-uuid");
    expect(result.soundchartsReleaseDate).toBeNull();
  });

  it("returns null for a resolved song with no audience", async () => {
    const api = client({ getLatestSpotifyAudienceSnapshot: vi.fn().mockResolvedValue(null) });
    const provider = new SoundchartsStreamCountProvider(api);

    await expect(provider.getStreamCountResult({ spotifyTrackId: "spotify-id" })).resolves.toMatchObject({
      soundchartsUuid: "resolved-uuid",
      streamCount: null,
      audienceDate: null,
      soundchartsReleaseDate: "1980-09-08T00:00:00+00:00",
      soundchartsGenres: [{ root: "Pop", sub: ["Art Pop"] }],
    });
  });

  it("labels only exhausted resolver misses as definitive not found", async () => {
    const noIsrc = new SoundchartsStreamCountProvider(client({
      getSongBySpotifyId: vi.fn().mockRejectedValue(new SoundchartsApiError("not_found", 404)),
    }));
    await expect(noIsrc.getStreamCountResult({ spotifyTrackId: "spotify-id" }))
      .rejects.toBeInstanceOf(DefinitiveSoundchartsNotFoundError);

    const bothResolvers = new SoundchartsStreamCountProvider(client({
      getSongBySpotifyId: vi.fn().mockRejectedValue(new SoundchartsApiError("not_found", 404)),
      getSongByIsrc: vi.fn().mockRejectedValue(new SoundchartsApiError("not_found", 404)),
    }));
    await expect(bothResolvers.getStreamCountResult({ spotifyTrackId: "spotify-id", isrc: "USABC1234567" }))
      .rejects.toBeInstanceOf(DefinitiveSoundchartsNotFoundError);
  });

  it("does not label an audience-endpoint not_found as a definitive resolver miss", async () => {
    const provider = new SoundchartsStreamCountProvider(client({
      getLatestSpotifyAudienceSnapshot: vi.fn().mockRejectedValue(new SoundchartsApiError("not_found", 404)),
    }));
    await expect(provider.getStreamCountResult({ spotifyTrackId: "spotify-id" })).rejects.toEqual(
      expect.not.objectContaining({ name: "DefinitiveSoundchartsNotFoundError" }),
    );
  });

  it("stops before an API call when the quota reserve is reached", async () => {
    const api = client({ quotaRemaining: 50 });
    const provider = new SoundchartsStreamCountProvider(api, 50);

    await expect(provider.getStreamCountResult({ spotifyTrackId: "spotify-id" })).rejects.toMatchObject({
      code: "quota_reserve",
    });
    expect(api.getSongBySpotifyId).not.toHaveBeenCalled();
    expect(api.getLatestSpotifyAudienceSnapshot).not.toHaveBeenCalled();
  });

  it("stops after resolution when that request reaches the reserve", async () => {
    let remaining = 51;
    const api: SoundchartsProviderClient = {
      get quotaRemaining() { return remaining; },
      getSongBySpotifyId: vi.fn().mockImplementation(async () => {
        remaining = 50;
        return { uuid: "resolved-uuid", releaseDate: null, genres: null };
      }),
      getSongByIsrc: vi.fn(),
      getLatestSpotifyAudienceSnapshot: vi.fn(),
    };
    const provider = new SoundchartsStreamCountProvider(api, 50);

    await expect(provider.getStreamCountResult({ spotifyTrackId: "spotify-id" })).rejects.toMatchObject({
      code: "quota_reserve",
    });
    expect(api.getLatestSpotifyAudienceSnapshot).not.toHaveBeenCalled();
  });
});
