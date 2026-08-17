import { afterEach, describe, expect, it, vi } from "vitest";
import { SpotifyApiError, spotifyFetch } from "@/lib/spotify/api";

afterEach(() => vi.unstubAllGlobals());

describe("Spotify API retries", () => {
  it("retries one 429 with bounded Retry-After", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429, headers: { "retry-after": "60" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(spotifyFetch<{ ok: boolean }>("token", "/search", {}, { sleep, maxRetryAfterSeconds: 3 })).resolves.toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry indefinitely", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 429 })));
    await expect(spotifyFetch("token", "/search", {}, { sleep, maxRetries: 1 })).rejects.toBeInstanceOf(SpotifyApiError);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not retry a quota-exceeded response", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ reason: "QUOTA_EXCEEDED" }), { status: 429 })));
    await expect(spotifyFetch("token", "/search", {}, { sleep })).rejects.toBeInstanceOf(SpotifyApiError);
    expect(sleep).not.toHaveBeenCalled();
  });
});
