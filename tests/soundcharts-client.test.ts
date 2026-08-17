import { describe, expect, it, vi } from "vitest";
import {
  parseAccessTokenResponse,
  parseLatestSpotifyAudience,
  parseLatestSpotifyAudienceSnapshot,
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

function tokenResponse(): Response {
  return jsonResponse({ access_token: "test-access-token", token_type: "bearer", expires_in: 3600 });
}

describe("Soundcharts response parsing", () => {
  it("parses a client-credentials token response", () => {
    expect(parseAccessTokenResponse({ access_token: "token", expires_in: 3600 })).toBe("token");
  });

  it("parses a song UUID response", () => {
    expect(parseSongUuidResponse({ type: "song", object: { uuid: "song-uuid" } })).toBe("song-uuid");
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

describe("Soundcharts HTTP errors", () => {
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

  it("retries HTTP 429 once and then reports rate limiting", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({}, 429, { "Retry-After": "30" }))
      .mockResolvedValueOnce(jsonResponse({}, 429));
    const client = new SoundchartsClient({ fetch: fetchMock, sleep, credentials });

    await expect(client.getSongBySpotifyId("spotify-id")).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
    expect(sleep).toHaveBeenCalledWith(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(client.requestCount).toBe(3);
  });

  it("uses current resolver and minimal audience endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ object: { uuid: "song-uuid" } }))
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

  it("requests an unfiltered latest snapshot and tracks quota headers", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        items: [{ date: "2026-08-16T00:00:00+00:00", plots: [] }],
      }, 200, { "x-quota-remaining": "803" }));
    const client = new SoundchartsClient({ fetch: fetchMock, credentials });

    await client.getLatestSpotifyAudienceSnapshot("song-uuid");

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://customer.api.soundcharts.com/api/v2/song/song-uuid/audience/spotify?sort=desc&limit=1",
    );
    expect(client.quotaRemaining).toBe(803);
  });

  it("uses the free usage endpoint to refresh quota information", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({}, 200, { "x-quota-remaining": "900" }));
    const client = new SoundchartsClient({ fetch: fetchMock, credentials });

    await expect(client.refreshQuotaRemaining()).resolves.toBe(900);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://customer.api.soundcharts.com/api/v2/team/usage");
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
