import { describe, expect, it, vi } from "vitest";
import {
  parseAccessTokenResponse,
  parseLatestSpotifyAudience,
  parseLatestSpotifyAudienceSnapshot,
  parseSoundchartsSongResponse,
  parseSongUuidResponse,
  SoundchartsApiError,
  SoundchartsClient,
} from "@/lib/soundcharts/client";

const credentials = { clientId: "test-client", clientSecret: "test-secret" };

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function tokenResponse(headers?: HeadersInit): Response {
  return jsonResponse(
    { access_token: "test-access-token", token_type: "bearer", expires_in: 3600 },
    200,
    headers,
  );
}

function uuidResponse(headers?: HeadersInit): Response {
  return jsonResponse({ object: { uuid: "song-uuid" } }, 200, headers);
}

describe("Soundcharts response parsing", () => {
  it("parses a client-credentials token response", () => {
    expect(parseAccessTokenResponse({ access_token: "token", expires_in: 3600 })).toBe("token");
  });

  it("parses a song UUID response", () => {
    expect(parseSongUuidResponse({ type: "song", object: { uuid: "song-uuid" } })).toBe("song-uuid");
  });

  it("retains normalized optional song metadata from a resolver response", () => {
    expect(parseSoundchartsSongResponse({
      type: "song",
      object: {
        uuid: "song-uuid",
        releaseDate: "1980-09-08T00:00:00+00:00",
        genres: [{ root: " Pop ", sub: ["Art Pop", "Art Pop", ""] }],
      },
    })).toEqual({
      uuid: "song-uuid",
      releaseDate: "1980-09-08T00:00:00+00:00",
      genres: [{ root: "Pop", sub: ["Art Pop"] }],
    });
  });

  it("resolves a UUID when optional song metadata is absent or malformed", () => {
    expect(parseSoundchartsSongResponse({ object: { uuid: "song-uuid" } })).toEqual({
      uuid: "song-uuid",
      releaseDate: null,
      genres: null,
    });
    expect(parseSoundchartsSongResponse({
      object: { uuid: "song-uuid", releaseDate: "not-a-date", genres: "Pop" },
    })).toEqual({ uuid: "song-uuid", releaseDate: null, genres: null });
  });

  it("selects the latest matching Spotify audience point", () => {
    expect(parseLatestSpotifyAudience({
      items: [
        { date: "2026-08-15T00:00:00+00:00", plots: [{ identifier: "spotify-id", value: 100 }] },
        { date: "2026-08-16T00:00:00+00:00", plots: [{ identifier: "spotify-id", value: 125 }] },
      ],
    }, "spotify-id")).toEqual({ date: "2026-08-16T00:00:00+00:00", streams: 125 });
  });

  it("returns null when no audience point exists for the requested Spotify ID", () => {
    expect(parseLatestSpotifyAudience({ items: [] }, "spotify-id")).toBeNull();
    expect(parseLatestSpotifyAudience({
      items: [{ date: "2026-08-16T00:00:00+00:00", plots: [{ identifier: "other-id", value: 125 }] }],
    }, "spotify-id")).toBeNull();
  });

  it("keeps all plots from the latest audience date", () => {
    expect(parseLatestSpotifyAudienceSnapshot({
      items: [{
        date: "2026-08-16T00:00:00+00:00",
        plots: [
          { identifier: "spotify-a", value: 100 },
          { identifier: "spotify-b", value: 50 },
        ],
      }],
    })).toEqual({
      date: "2026-08-16T00:00:00+00:00",
      plots: [
        { identifier: "spotify-a", value: 100 },
        { identifier: "spotify-b", value: 50 },
      ],
    });
  });

  it.each([
    [parseAccessTokenResponse, {}],
    [parseSongUuidResponse, { object: {} }],
    [(payload: unknown) => parseLatestSpotifyAudience(payload, "spotify-id"), { items: [{ date: "bad", plots: [] }] }],
  ])("rejects malformed responses", (parser, payload) => {
    expect(() => parser(payload)).toThrowError(SoundchartsApiError);
  });
});

describe("Soundcharts request telemetry and guards", () => {
  it("separates OAuth and customer requests and tracks only valid customer quota headers", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse({ "x-quota-remaining": "999" }))
      .mockResolvedValueOnce(uuidResponse({ "x-quota-remaining": "900" }))
      .mockResolvedValueOnce(uuidResponse())
      .mockResolvedValueOnce(uuidResponse({ "x-quota-remaining": "not-a-number" }))
      .mockResolvedValueOnce(uuidResponse({ "x-quota-remaining": "895" }))
      .mockResolvedValueOnce(uuidResponse({ "x-quota-remaining": "897" }));
    const client = new SoundchartsClient({ fetch: fetchMock, credentials });

    await client.getSongBySpotifyId("one");
    await client.getSongBySpotifyId("two");
    await client.getSongBySpotifyId("three");
    await client.getSongBySpotifyId("four");
    await client.getSongBySpotifyId("five");

    expect(client.telemetry).toEqual({
      totalHttpRequests: 6,
      tokenRequests: 1,
      customerApiRequests: 5,
      retryRequests: 0,
      quotaHeaderObservations: 3,
      firstQuotaRemaining: 900,
      lastQuotaRemaining: 897,
      minimumQuotaRemaining: 895,
      observedQuotaDelta: 3,
    });
    expect(client.quotaRemaining).toBe(897);
  });

  it("counts a 429 retry as both a customer request and a retry request", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({}, 429, { "Retry-After": "30", "x-quota-remaining": "100" }))
      .mockResolvedValueOnce(jsonResponse({}, 429, { "x-quota-remaining": "99" }));
    const client = new SoundchartsClient({ fetch: fetchMock, sleep, credentials });

    await expect(client.getSongBySpotifyId("spotify-id")).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
    expect(sleep).toHaveBeenCalledWith(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(client.telemetry).toMatchObject({
      totalHttpRequests: 3,
      tokenRequests: 1,
      customerApiRequests: 2,
      retryRequests: 1,
      quotaHeaderObservations: 2,
      observedQuotaDelta: 1,
    });
  });

  it("never issues a third customer attempt after a retry consumes budget two", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 429));
    const client = new SoundchartsClient({
      fetch: fetchMock,
      sleep,
      credentials,
      maxRateLimitRetries: 5,
      maxCustomerApiRequests: 2,
    });

    await expect(client.getSongBySpotifyId("spotify-id")).rejects.toMatchObject({ code: "request_budget" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(client.telemetry).toMatchObject({ customerApiRequests: 2, retryRequests: 1 });
  });

  it("uses the request budget while quota is unknown", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(uuidResponse());
    const client = new SoundchartsClient({ fetch: fetchMock, credentials, maxCustomerApiRequests: 1 });

    await client.getSongBySpotifyId("first");
    await expect(client.getSongBySpotifyId("second")).rejects.toMatchObject({ code: "request_budget" });
    expect(client.quotaRemaining).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("blocks the next customer operation when an observed header reaches reserve", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(uuidResponse({ "x-quota-remaining": "50" }));
    const client = new SoundchartsClient({ fetch: fetchMock, credentials, quotaReserve: 50 });

    await client.getSongBySpotifyId("first");
    await expect(client.getSongBySpotifyId("second")).rejects.toMatchObject({ code: "quota_reserve" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("Soundcharts HTTP behavior", () => {
  it.each([
    [401, "authentication_failed"],
    [403, "forbidden"],
    [404, "not_found"],
  ] as const)("classifies HTTP %s", async (status, code) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({}, status));
    const client = new SoundchartsClient({ fetch: fetchMock, credentials });

    await expect(client.getSongBySpotifyId("spotify-id")).rejects.toMatchObject({ status, code });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses current resolver and minimal audience endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(uuidResponse())
      .mockResolvedValueOnce(jsonResponse({
        items: [{ date: "2026-08-16T00:00:00+00:00", plots: [{ identifier: "spotify-id", value: 125 }] }],
      }));
    const client = new SoundchartsClient({ fetch: fetchMock, credentials });

    await client.getSongBySpotifyId("spotify-id");
    await client.getLatestSpotifyAudience("song-uuid", "spotify-id");

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://customer.api.soundcharts.com/api/v2.25/song/by-platform/spotify/spotify-id",
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://customer.api.soundcharts.com/api/v2/song/song-uuid/audience/spotify?sort=desc&limit=1&identifier=spotify-id",
    );
  });

  it("requests an unfiltered latest snapshot", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        items: [{ date: "2026-08-16T00:00:00+00:00", plots: [] }],
      }));
    const client = new SoundchartsClient({ fetch: fetchMock, credentials });

    await client.getLatestSpotifyAudienceSnapshot("song-uuid");

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://customer.api.soundcharts.com/api/v2/song/song-uuid/audience/spotify?sort=desc&limit=1",
    );
  });

  it("retains team usage only as an explicit legacy operation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({}, 200, { "x-quota-remaining": "900" }));
    const client = new SoundchartsClient({ fetch: fetchMock, credentials });

    expect(fetchMock).not.toHaveBeenCalled();
    await expect(client.refreshQuotaRemaining()).resolves.toBe(900);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://customer.api.soundcharts.com/api/v2/team/usage");
  });

  it("retains only a short structured API error message", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Plan does not include this endpoint" } }, 403));
    const client = new SoundchartsClient({ fetch: fetchMock, credentials });

    await expect(client.getSongBySpotifyId("spotify-id")).rejects.toMatchObject({
      code: "forbidden",
      apiMessage: "Plan does not include this endpoint",
    });
  });

  it("rejects a malformed successful HTTP response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ object: {} }));
    const client = new SoundchartsClient({ fetch: fetchMock, credentials });

    await expect(client.getSongBySpotifyId("spotify-id")).rejects.toMatchObject({
      code: "malformed_response",
    });
  });
});
