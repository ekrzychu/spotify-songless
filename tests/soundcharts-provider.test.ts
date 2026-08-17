import { describe, expect, it, vi } from "vitest";
import { SoundchartsApiError } from "@/lib/soundcharts/client";
import {
  SoundchartsStreamCountProvider,
  type SoundchartsProviderClient,
} from "@/lib/streams/soundcharts-provider";

function client(overrides: Partial<SoundchartsProviderClient> = {}): SoundchartsProviderClient {
  return {
    quotaRemaining: 500,
    getSongBySpotifyId: vi.fn().mockResolvedValue("resolved-uuid"),
    getSongByIsrc: vi.fn().mockResolvedValue("isrc-uuid"),
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
  });

  it("returns null for a resolved song with no audience", async () => {
    const api = client({ getLatestSpotifyAudienceSnapshot: vi.fn().mockResolvedValue(null) });
    const provider = new SoundchartsStreamCountProvider(api);

    await expect(provider.getStreamCountResult({ spotifyTrackId: "spotify-id" })).resolves.toMatchObject({
      soundchartsUuid: "resolved-uuid",
      streamCount: null,
      audienceDate: null,
    });
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
        return "resolved-uuid";
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
